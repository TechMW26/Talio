import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { generateContent } from '@/lib/gemini'
import { clearCachePattern, buildCachePattern } from '@/lib/cache'
import {
  buildLeaveBalanceFields,
  normalizeLeaveBalance,
  normalizeLeaveTypes,
} from '@/lib/leaveData'

// POST - Bulk import leave balances from CSV/text data using AI parsing
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['Employee', 'LeaveType', 'LeaveBalance'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { Employee, LeaveType, LeaveBalance } = models

    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file')
    const year = parseInt(formData.get('year')) || new Date().getFullYear()
    const mode = formData.get('mode') || 'preview' // 'preview' or 'apply'

    if (!file) {
      return NextResponse.json(
        { success: false, message: 'File is required' },
        { status: 400 }
      )
    }

    // Read file content
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const fileContent = buffer.toString('utf-8')

    if (!fileContent.trim()) {
      return NextResponse.json(
        { success: false, message: 'File is empty' },
        { status: 400 }
      )
    }

    // Get all employees and leave types for matching
    const [employees, rawLeaveTypes] = await Promise.all([
      Employee.find({ status: 'active' }).select('firstName lastName employeeCode email department').lean(),
      LeaveType.find({ isActive: true }).select('name code maxDaysPerYear daysPerYear').lean(),
    ])
    const leaveTypes = normalizeLeaveTypes(rawLeaveTypes)

    if (employees.length === 0) {
      return NextResponse.json({ success: false, message: 'No active employees found' }, { status: 400 })
    }
    if (leaveTypes.length === 0) {
      return NextResponse.json({ success: false, message: 'No active leave types found' }, { status: 400 })
    }

    // Build context for AI
    const employeeList = employees.map(e =>
      `${e._id}|${e.employeeCode || 'N/A'}|${e.firstName} ${e.lastName}|${e.email || ''}`
    ).join('\n')

    const leaveTypeList = leaveTypes.map(lt =>
      `${lt._id}|${lt.code}|${lt.name}|max:${lt.maxDaysPerYear}`
    ).join('\n')

    const systemInstruction = `You are a data parser for an HR leave management system. Your job is to extract leave balance allocations from uploaded file data and match them to the correct employees and leave types.

EMPLOYEES (format: id|code|name|email):
${employeeList}

LEAVE TYPES (format: id|code|name|maxDays):
${leaveTypeList}

RULES:
- Match employees by employee code, name, or email (fuzzy match is OK).
- Match leave types by code or name (fuzzy match is OK, e.g. "CL" matches "Casual Leave" with code "CL").
- The totalDays must be a positive integer.
- If you cannot confidently match an employee or leave type, set matched to false and provide the original text in unmatchedEmployee or unmatchedLeaveType.
- Return ONLY valid JSON, no markdown, no code fences.

OUTPUT FORMAT (JSON array):
[
  {
    "employeeId": "<employee _id or null>",
    "employeeName": "<matched employee name>",
    "employeeCode": "<matched employee code>",
    "leaveTypeId": "<leave type _id or null>",
    "leaveTypeName": "<matched leave type name>",
    "totalDays": <number>,
    "matched": true/false,
    "unmatchedEmployee": "<original text if not matched>",
    "unmatchedLeaveType": "<original text if not matched>",
    "row": <original row number>
  }
]`

    const prompt = `Parse the following uploaded file data and extract leave balance allocations. Match each row to the correct employee and leave type from the lists provided in the system instruction.

FILE CONTENT:
${fileContent.substring(0, 15000)}`

    let parsedData
    try {
      const aiResponse = await generateContent(prompt, systemInstruction)
      // Clean up response - remove markdown fences if present
      let cleanResponse = aiResponse.trim()
      if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }
      parsedData = JSON.parse(cleanResponse)
    } catch (parseError) {
      console.error('AI parsing error:', parseError)
      return NextResponse.json(
        { success: false, message: 'Failed to parse file content. Please ensure the file contains structured leave data (CSV format with employee names/codes and leave type columns).' },
        { status: 400 }
      )
    }

    if (!Array.isArray(parsedData) || parsedData.length === 0) {
      return NextResponse.json(
        { success: false, message: 'No leave allocation data could be extracted from the file.' },
        { status: 400 }
      )
    }

    // Preview mode — return parsed data for user confirmation
    if (mode === 'preview') {
      return NextResponse.json({
        success: true,
        data: parsedData,
        summary: {
          total: parsedData.length,
          matched: parsedData.filter(d => d.matched).length,
          unmatched: parsedData.filter(d => !d.matched).length,
        },
        year,
      })
    }

    // Apply mode — create/update leave balances
    const allocationsToApply = formData.get('allocations')
    let confirmedAllocations
    try {
      confirmedAllocations = JSON.parse(allocationsToApply)
    } catch {
      return NextResponse.json(
        { success: false, message: 'Invalid allocations data' },
        { status: 400 }
      )
    }

    let created = 0
    let updated = 0
    let failed = 0
    const errors = []

    for (const alloc of confirmedAllocations) {
      if (!alloc.employeeId || !alloc.leaveTypeId || !alloc.totalDays) {
        failed++
        errors.push(`Skipped: missing data for ${alloc.employeeName || 'unknown'}`)
        continue
      }

      try {
        const totalDays = parseInt(alloc.totalDays)
        if (isNaN(totalDays) || totalDays < 0) {
          failed++
          errors.push(`Invalid days for ${alloc.employeeName}: ${alloc.totalDays}`)
          continue
        }

        const existing = await LeaveBalance.findOne({
          employee: alloc.employeeId,
          leaveType: alloc.leaveTypeId,
          year,
        })

        if (existing) {
          const currentBalance = normalizeLeaveBalance(existing)
          existing.set(buildLeaveBalanceFields({
            totalDays,
            usedDays: currentBalance.usedDays,
            pending: currentBalance.pending,
            carriedForward: currentBalance.carriedForward,
          }))
          await existing.save()
          updated++
        } else {
          await LeaveBalance.create({
            employee: alloc.employeeId,
            leaveType: alloc.leaveTypeId,
            year,
            ...buildLeaveBalanceFields({ totalDays }),
          })
          created++
        }
      } catch (err) {
        failed++
        errors.push(`Failed for ${alloc.employeeName}: ${err.message}`)
      }
    }

    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'leave-balance', userId: '*' }))
    await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:unified', userId: '*' }))

    return NextResponse.json({
      success: true,
      message: `Import completed: ${created} created, ${updated} updated, ${failed} failed`,
      created,
      updated,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('Bulk import error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to process bulk import' },
      { status: 500 }
    )
  }
}
