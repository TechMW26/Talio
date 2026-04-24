/**
 * Shared utility for generating KRIs (Key Responsibility Indicators)
 * and starter KPIs from an employee's designation + department via AI.
 *
 * Used by:
 *   - /api/profile/kri          (manual user-triggered regeneration)
 *   - /api/employees [POST]     (auto on employee create)
 *   - /api/employees/[id] [PUT] (auto on designation/department change i.e. promotion)
 *   - scripts/backfillKRIs.js   (one-off backfill for existing employees)
 */

import { generateSmartContent } from './promptEngine'
import { formatDesignation, formatDepartments } from './formatters'

function parseResponsibilities(rawText) {
  const trimmed = (rawText || '').trim()
  const jsonMatch = trimmed.match(/\[[\s\S]*\]|\{[\s\S]*\}/)

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      const arr = Array.isArray(parsed) ? parsed : parsed?.responsibilities
      if (Array.isArray(arr) && arr.length > 0) {
        return arr
          .map((item) => ({
            title: (item?.title || item?.name || '').toString().trim(),
            description: (item?.description || item?.details || '').toString().trim(),
            importance: ['high', 'medium', 'low'].includes(item?.importance) ? item.importance : 'medium',
          }))
          .filter((item) => item.title)
          .slice(0, 8)
      }
    } catch {
      // fall through to bullet parsing
    }
  }

  return trimmed
    .split(/\n|\r|•|- /)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 8)
    .map((line) => ({
      title: line.length > 60 ? `${line.slice(0, 57)}...` : line,
      description: line,
      importance: 'medium',
    }))
}

function parseKPIs(rawText) {
  const trimmed = (rawText || '').trim()
  const jsonMatch = trimmed.match(/\[[\s\S]*\]|\{[\s\S]*\}/)
  if (!jsonMatch) return []
  try {
    const parsed = JSON.parse(jsonMatch[0])
    const arr = Array.isArray(parsed) ? parsed : parsed?.kpis
    if (!Array.isArray(arr)) return []
    return arr
      .map((item) => ({
        name: (item?.name || item?.title || '').toString().trim(),
        target: (item?.target ?? '').toString().trim(),
        unit: (item?.unit || '').toString().trim(),
        notes: (item?.notes || item?.description || '').toString().trim(),
      }))
      .filter((item) => item.name)
      .slice(0, 6)
  } catch {
    return []
  }
}

export async function generateResponsibilitiesForEmployee(employee, userId) {
  const designation = formatDesignation(employee.designation, employee) || employee.designationLevelName || 'Unknown designation'
  const departments = formatDepartments(employee) || 'General'
  const manualKRIs = Array.isArray(employee.manualKRIs) ? employee.manualKRIs.filter(Boolean) : []

  const prompt = `You are an HR role architecture assistant.
Generate key responsibilities for this employee role so productivity/performance AI can evaluate context correctly.

Employee:
- Name: ${employee.firstName || ''} ${employee.lastName || ''}
- Designation: ${designation}
- Department(s): ${departments}
- Organization Role: ${employee.systemRole || 'employee'}
- Existing manually set KRIs: ${manualKRIs.length > 0 ? manualKRIs.join('; ') : 'none'}

Rules:
- Return ONLY JSON.
- Prioritize responsibilities that can be inferred from digital work evidence (apps, websites, docs, comms).
- Include work types like research, ideation, editing, collaboration where role-appropriate.
- Do NOT include generic HR fluff.
- Keep each responsibility concise and specific.

Return this exact JSON structure:
{
  "responsibilities": [
    { "title": "...", "description": "...", "importance": "high|medium|low" }
  ]
}`

  const text = await generateSmartContent(prompt, {
    userId,
    feature: 'profile-kri-generation',
    skipRefinement: true,
    skipGuardrails: true,
    skipContext: true,
  })

  return parseResponsibilities(text)
}

export async function generateStarterKPIsForEmployee(employee, userId) {
  const designation = formatDesignation(employee.designation, employee) || employee.designationLevelName || 'Unknown designation'
  const departments = formatDepartments(employee) || 'General'

  const prompt = `You are an HR performance design assistant.
Generate 4-6 measurable starter KPIs for this role. Each KPI should be concrete and quantifiable.

Employee:
- Designation: ${designation}
- Department(s): ${departments}

Rules:
- Return ONLY JSON.
- Each KPI must include a numeric or quantifiable target.
- Use realistic units (count, %, hours, days, etc.).
- Do NOT use vague language.

Return exactly:
{
  "kpis": [
    { "name": "...", "target": "...", "unit": "...", "notes": "..." }
  ]
}`

  const text = await generateSmartContent(prompt, {
    userId,
    feature: 'profile-kpi-generation',
    skipRefinement: true,
    skipGuardrails: true,
    skipContext: true,
  })

  return parseKPIs(text)
}

/**
 * Generate AND persist KRIs (and starter KPIs only if employee has none yet).
 * Designed to be safe to call fire-and-forget.
 */
export async function generateAndStoreKRIsKPIs({ Employee, employeeId, userId, generateKPIs = true }) {
  if (!Employee || !employeeId) return null
  try {
    const employee = await Employee.findById(employeeId)
      .populate('designation', 'title level levelName')
      .populate('department', 'name')
      .populate('departments', 'name')
    if (!employee) return null

    const responsibilities = await generateResponsibilitiesForEmployee(employee, userId)
    const update = {
      aiGeneratedKRIs: responsibilities,
      aiGeneratedKRIsMeta: {
        generatedAt: new Date(),
        generatedFromDesignation: formatDesignation(employee.designation, employee),
        generatedFromDepartment: formatDepartments(employee),
      },
    }

    if (generateKPIs && (!Array.isArray(employee.manualKPIs) || employee.manualKPIs.length === 0)) {
      try {
        const kpis = await generateStarterKPIsForEmployee(employee, userId)
        if (kpis.length > 0) update.manualKPIs = kpis
      } catch (kpiErr) {
        console.warn('[KRI Generator] Starter KPI generation failed:', kpiErr.message)
      }
    }

    await Employee.findByIdAndUpdate(employeeId, { $set: update })
    return update
  } catch (err) {
    console.error('[KRI Generator] generateAndStoreKRIsKPIs failed:', err.message)
    return null
  }
}
