import { isFeatureEnabled } from '@/lib/planFeatures'
import { createWorkflow } from '@/lib/hrms/workflowService.server'

export const ONBOARDING_TEMPLATES = Object.freeze({
  standard: 'Standard employee',
  experienced: 'Experienced hire',
  intern: 'Intern or trainee',
  contractor: 'Contractor',
})

const BASE_CHECKLIST = [
  ['profile', 'Complete employee profile and emergency contact'],
  ['documents', 'Collect identity, tax and employment documents'],
  ['payroll', 'Verify bank, payroll and statutory enrolment'],
  ['policies', 'Acknowledge company policies'],
  ['induction', 'Complete company and department induction'],
]

export const AUTOMATIC_ONBOARDING_ITEM_KEYS = Object.freeze([
  'profile',
  'documents',
  'background_verification',
  'payroll',
  'policies',
  'induction',
  'assets',
])

export function toIstDateKey(value) {
  if (!value) return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function parseDate(value, fieldName) {
  if (!value) return null
  const dateKey = toIstDateKey(value)
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new Error(`${fieldName} is invalid`)
  return date
}

export function addMonthsClamped(value, months) {
  const date = parseDate(value, 'Date')
  const count = Number(months)
  if (!Number.isInteger(count) || count < 1 || count > 24) throw new Error('Duration must be between 1 and 24 months')
  const day = date.getUTCDate()
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1, 12))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target
}

function onboardingChecklist({ backgroundVerificationRequired, assetProvisioningRequired }) {
  const items = BASE_CHECKLIST.map(([key, label]) => ({ key, label, required: true, completed: false }))
  if (backgroundVerificationRequired) items.splice(2, 0, { key: 'background_verification', label: 'Complete background verification', required: true, completed: false })
  if (assetProvisioningRequired) items.push({ key: 'assets', label: 'Issue assigned equipment and access', required: true, completed: false })
  return items
}

export function buildEmployeeLifecycle(input = {}, now = new Date()) {
  const joiningDate = parseDate(input.dateOfJoining, 'Date of joining')
  if (!joiningDate) throw new Error('Date of joining is required')

  const template = ONBOARDING_TEMPLATES[input.onboardingTemplate]
    ? input.onboardingTemplate
    : input.employmentType === 'intern'
      ? 'intern'
      : input.employmentType === 'contract'
        ? 'contractor'
        : 'standard'
  const probationApplicable = input.probationApplicable !== false && input.employmentType !== 'contract'
  const durationMonths = Math.min(24, Math.max(1, Number.parseInt(input.probationDurationMonths, 10) || (input.employmentType === 'intern' ? 1 : 3)))
  const backgroundVerificationRequired = input.backgroundVerificationRequired !== false
  const assetProvisioningRequired = input.assetProvisioningRequired !== false
  const isFutureJoiner = toIstDateKey(joiningDate) > toIstDateKey(now)
  const probationEnd = probationApplicable ? addMonthsClamped(joiningDate, durationMonths) : null

  return {
    stage: isFutureJoiner ? 'preboarding' : 'onboarding',
    onboarding: {
      template,
      status: isFutureJoiner ? 'not_started' : 'in_progress',
      owner: input.onboardingOwner || null,
      targetDate: addMonthsClamped(joiningDate, 1),
      checklist: onboardingChecklist({ backgroundVerificationRequired, assetProvisioningRequired }),
    },
    probation: {
      applicable: probationApplicable,
      durationMonths,
      status: probationApplicable ? (isFutureJoiner ? 'not_started' : 'in_progress') : 'waived',
      startDate: joiningDate,
      reviewDate: probationEnd,
      endDate: probationEnd,
    },
    noticePeriodDays: Math.min(365, Math.max(0, input.noticePeriodDays === 0 || input.noticePeriodDays === '0' ? 0 : Number.parseInt(input.noticePeriodDays, 10) || 30)),
    backgroundVerificationRequired,
    assetProvisioningRequired,
    offboarding: {
      status: 'not_started',
      exitInterviewCompleted: false,
      assetsReturned: !assetProvisioningRequired,
      accessRevoked: false,
      fullAndFinalStatus: 'not_started',
      experienceLetterStatus: 'not_started',
    },
  }
}

export function hydrateEmployeeLifecycle(employee = {}, now = new Date()) {
  const base = buildEmployeeLifecycle({
    dateOfJoining: employee.dateOfJoining || employee.createdAt || now,
    employmentType: employee.employmentType,
    probationApplicable: employee.lifecycle?.probation?.applicable,
    probationDurationMonths: employee.lifecycle?.probation?.durationMonths,
    onboardingTemplate: employee.lifecycle?.onboarding?.template,
    noticePeriodDays: employee.lifecycle?.noticePeriodDays,
    backgroundVerificationRequired: employee.lifecycle?.backgroundVerificationRequired,
    assetProvisioningRequired: employee.lifecycle?.assetProvisioningRequired,
  }, now)
  const lifecycle = clone(employee.lifecycle)
  return {
    ...base,
    ...lifecycle,
    onboarding: {
      ...base.onboarding,
      ...lifecycle.onboarding,
      checklist: lifecycle.onboarding?.checklist?.length ? lifecycle.onboarding.checklist : base.onboarding.checklist,
    },
    probation: { ...base.probation, ...lifecycle.probation },
    offboarding: { ...base.offboarding, ...lifecycle.offboarding },
  }
}

export function getLifecycleProgress(lifecycle = {}) {
  const checklist = lifecycle.onboarding?.checklist || []
  const required = checklist.filter((item) => item.required !== false)
  const completed = required.filter((item) => item.completed).length
  return {
    completed,
    total: required.length,
    percentage: required.length ? Math.round((completed / required.length) * 100) : 100,
  }
}

function advanceCompletedOnboarding(lifecycle, now) {
  const progress = getLifecycleProgress(lifecycle)
  if (progress.percentage === 100) {
    lifecycle.onboarding.status = 'completed'
    lifecycle.onboarding.completedAt ||= now
    lifecycle.stage = lifecycle.probation?.applicable && !['confirmed', 'waived'].includes(lifecycle.probation.status)
      ? 'probation'
      : 'confirmed'
  }
}

export function reconcileOnboardingChecklist(lifecycle, signals = {}, context = {}) {
  const next = clone(lifecycle)
  if (!next.onboarding?.checklist?.length) return { lifecycle: next, changed: false, completedKeys: [] }

  const before = JSON.stringify(next)
  const now = context.now ? parseDate(context.now, 'Current date') : new Date()
  const completedKeys = []

  for (const item of next.onboarding.checklist) {
    if (!AUTOMATIC_ONBOARDING_ITEM_KEYS.includes(item.key) || signals[item.key] !== true || item.completed) continue
    item.completed = true
    item.completedAt = now
    item.completedBy = null
    item.completionSource = 'system'
    completedKeys.push(item.key)
  }

  advanceCompletedOnboarding(next, now)
  return { lifecycle: next, changed: before !== JSON.stringify(next), completedKeys }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}))
}

export function applyLifecycleAction(lifecycle, action, payload = {}, context = {}) {
  const next = clone(lifecycle)
  const now = context.now ? parseDate(context.now, 'Current date') : new Date()
  const actorId = context.actorId || null
  const employeeUpdates = {}

  if (action === 'complete_onboarding_item') {
    const item = next.onboarding?.checklist?.find((entry) => entry.key === payload.itemKey)
    if (!item) throw new Error('Onboarding checklist item not found')
    item.completed = payload.completed !== false
    item.completedAt = item.completed ? now : null
    item.completedBy = item.completed ? actorId : null
    item.completionSource = item.completed ? 'manual' : null
    const progress = getLifecycleProgress(next)
    if (progress.percentage === 100) {
      next.onboarding.status = 'completed'
      next.onboarding.completedAt = now
      next.stage = next.probation?.applicable && !['confirmed', 'waived'].includes(next.probation.status) ? 'probation' : 'confirmed'
    } else {
      next.onboarding.status = 'in_progress'
      next.onboarding.completedAt = null
      if (!['notice_period', 'offboarding', 'alumni'].includes(next.stage)) next.stage = 'onboarding'
    }
  } else if (action === 'confirm_probation') {
    if (!next.probation?.applicable || ['confirmed', 'waived'].includes(next.probation.status)) throw new Error('Probation is not awaiting confirmation')
    next.probation.status = 'confirmed'
    next.probation.confirmedAt = now
    if (!['notice_period', 'offboarding', 'alumni'].includes(next.stage)) next.stage = 'confirmed'
    employeeUpdates.status = 'active'
  } else if (action === 'extend_probation') {
    if (!next.probation?.applicable || ['confirmed', 'waived'].includes(next.probation.status)) throw new Error('Only an active probation can be extended')
    const months = Number.parseInt(payload.months, 10)
    if (!String(payload.reason || '').trim()) throw new Error('An extension reason is required')
    next.probation.endDate = addMonthsClamped(next.probation.endDate || next.probation.startDate, months)
    next.probation.reviewDate = next.probation.endDate
    next.probation.durationMonths = Math.min(24, Number(next.probation.durationMonths || 0) + months)
    next.probation.status = 'extended'
    next.probation.extendedAt = now
    next.probation.extensionReason = String(payload.reason).trim().slice(0, 1000)
    next.stage = 'probation'
    employeeUpdates.status = 'probation'
  } else if (action === 'start_offboarding') {
    const resignationDate = parseDate(payload.resignationDate || now, 'Resignation date')
    const lastWorkingDate = parseDate(payload.lastWorkingDate, 'Last working date')
    if (!lastWorkingDate) throw new Error('Last working date is required')
    if (lastWorkingDate < resignationDate) throw new Error('Last working date cannot be before the resignation date')
    next.stage = lastWorkingDate > now ? 'notice_period' : 'offboarding'
    next.offboarding = {
      ...next.offboarding,
      status: 'in_progress',
      separationType: payload.separationType || 'resignation',
      resignationDate,
      lastWorkingDate,
      reason: String(payload.reason || '').trim().slice(0, 2000),
      fullAndFinalStatus: 'pending',
      experienceLetterStatus: 'pending',
    }
    employeeUpdates.dateOfLeaving = lastWorkingDate
  } else if (action === 'update_offboarding') {
    const allowed = new Set(['exitInterviewCompleted', 'assetsReturned', 'accessRevoked', 'fullAndFinalStatus', 'experienceLetterStatus'])
    if (!allowed.has(payload.field)) throw new Error('Unsupported offboarding field')
    next.offboarding[payload.field] = payload.value
    next.stage = 'offboarding'
    next.offboarding.status = 'clearance_pending'
  } else if (action === 'complete_offboarding') {
    if (!next.offboarding || next.offboarding.status === 'not_started') throw new Error('Offboarding has not started')
    if (!next.offboarding.assetsReturned || !next.offboarding.accessRevoked || next.offboarding.fullAndFinalStatus !== 'completed') {
      throw new Error('Assets, access revocation and full-and-final settlement must be cleared first')
    }
    next.stage = 'alumni'
    next.offboarding.status = 'completed'
    next.offboarding.completedAt = now
    employeeUpdates.status = next.offboarding.separationType === 'termination' ? 'terminated' : 'resigned'
    employeeUpdates.dateOfLeaving = next.offboarding.lastWorkingDate || now
  } else {
    throw new Error('Unsupported lifecycle action')
  }

  return { lifecycle: next, employeeUpdates }
}

export async function createInitialLifecycleWorkflows({ models, actor, employee, features = {} }) {
  const definitions = [
    ['onboarding', true, employee.lifecycle?.onboarding?.targetDate, { employeeName: `${employee.firstName} ${employee.lastName}`.trim(), joiningDate: employee.dateOfJoining }],
    ['backgroundVerification', employee.lifecycle?.backgroundVerificationRequired, employee.dateOfJoining, { candidateName: `${employee.firstName} ${employee.lastName}`.trim() }],
    ['departmentInduction', true, employee.lifecycle?.onboarding?.targetDate, { department: employee.department }],
    ['assets', employee.lifecycle?.assetProvisioningRequired, employee.dateOfJoining, { assetName: 'Joining equipment and access' }],
    ['probation', employee.lifecycle?.probation?.applicable, employee.lifecycle?.probation?.reviewDate, { reviewDate: employee.lifecycle?.probation?.reviewDate }],
  ]

  const results = []
  for (const [module, applicable, dueAt, data] of definitions) {
    if (!applicable || !isFeatureEnabled(features, module)) continue
    const result = await createWorkflow({
      Workflow: models.HrmsWorkflow,
      Event: models.HrmsWorkflowEvent,
      actor,
      bypassPermission: true,
      allowIncompleteData: true,
      payload: {
        module,
        title: `${module === 'probation' ? 'Probation' : 'Onboarding'}: ${employee.firstName} ${employee.lastName}`,
        subjectEmployee: employee._id,
        dueAt,
        data,
        source: { entityType: 'Employee', entityId: employee._id },
        idempotencyKey: `employee:${employee._id}:${module}`,
      },
    })
    if (result.success && !result.deduplicated) {
      await models.HrmsWorkflow.updateOne({ _id: result.workflow._id }, { $set: { status: 'in_progress' } })
      await models.HrmsWorkflowEvent.create({
        workflow: result.workflow._id,
        module,
        type: 'auto_started',
        fromStatus: 'draft',
        toStatus: 'in_progress',
        actor: actor.id || actor._id,
        metadata: { source: 'employee_creation' },
      })
    }
    results.push(result)
  }
  return results
}
