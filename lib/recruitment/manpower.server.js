import { createHash } from 'node:crypto'

export const HR_ROLES = ['hr', 'admin', 'super_admin', 'superadmin']
export const isManpowerHr = actor => HR_ROLES.includes(actor?.role)
const id = value => String(value?._id || value || '')
export const manpowerError = (message, status = 400) => Object.assign(new Error(message), { status })
export const canRequestManpower = actor => isManpowerHr(actor) || ['manager', 'team_leader', 'department_head'].includes(actor?.role) || Boolean(actor?.isDepartmentHead || actor?.isDepartmentManager || actor?.teamLeaderOf?.length)
function text(value, label, max = 200, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw manpowerError(`${label} must contain ${min}–${max} characters`)
  return value.trim()
}
function choice(value, choices, label) {
  if (!choices.includes(value)) throw manpowerError(`Choose a valid ${label}`)
  return value
}
function number(value, label, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) throw manpowerError(`Invalid ${label}`)
  return value
}
export function validateManpower(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw manpowerError('Invalid request')
  if (!/^[a-f\d]{24}$/i.test(input.department || '')) throw manpowerError('Choose a department')
  const job = {
    jobTitle: text(input.jobTitle, 'Job title'), department: input.department,
    jobDescription: text(input.jobDescription, 'Job description', 15000, 20),
    location: text(input.location, 'Location'),
    numberOfPositions: number(input.numberOfPositions, 'headcount', 1000, true),
    employmentType: choice(input.employmentType, ['full-time', 'part-time', 'contract', 'internship', 'freelance'], 'employment type'),
    workMode: choice(input.workMode, ['on-site', 'remote', 'hybrid'], 'work mode'),
    educationLevel: choice(input.educationLevel || 'any', ['any', 'high-school', 'associate', 'bachelor', 'master', 'doctorate'], 'education level'),
    experience: { min: number(input.experienceMin, 'minimum experience', 60), max: number(input.experienceMax, 'maximum experience', 60) },
    salaryRange: { min: number(input.salaryMin, 'minimum salary', 1e10), max: number(input.salaryMax, 'maximum salary', 1e10), currency: text(input.currency, 'Currency', 3, 3).toUpperCase(), isConfidential: true },
  }
  if (!job.numberOfPositions || job.experience.max < job.experience.min || job.salaryRange.max < job.salaryRange.min || !/^[A-Z]{3}$/.test(job.salaryRange.currency)) throw manpowerError('Check headcount, experience and salary ranges')
  for (const key of ['requirements', 'responsibilities', 'skills', 'benefits']) {
    if (!Array.isArray(input[key]) || input[key].length > 50) throw manpowerError(`Invalid ${key}`)
    job[key] = input[key].map(value => text(value, key, 1000))
    if (key !== 'benefits' && !job[key].length) throw manpowerError(`Add at least one ${key} entry`)
  }
  return { job, justification: text(input.justification, 'Justification', 4000, 10) }
}

// Both documents commit together. An approval retry returns the existing job,
// and a concurrent rejection cannot leave a published orphan job behind.
export async function reviewManpower(store, actor, input) {
  if (!isManpowerHr(actor)) throw manpowerError('Only HR or admins may review requests', 403)
  if (!/^[a-f\d]{24}$/i.test(input.id || '') || !['approve', 'reject'].includes(input.action)) throw manpowerError('Invalid review')
  const reviewReason = input.action === 'reject' ? text(input.reason, 'Rejection reason', 2000, 5) : ''
  return store.transaction(async tx => {
      actor = await tx.get('users', id(actor))
      if (!actor || actor.isActive === false || !isManpowerHr(actor)) throw manpowerError('Only active HR or admins may review requests', 403)
      const current = await tx.get('manpowerrequests', input.id)
      if (!current) throw manpowerError('Request not found', 404)
      if (id(current.requestedBy) === id(actor._id)) throw manpowerError('Another HR/admin must review your request', 403)
      if (current.status === 'approved' && input.action === 'approve') return { record: current, repeated: true }
      if (current.status !== 'pending') throw manpowerError('This request has already been reviewed. Refresh the list.', 409)
      const now = new Date()
      let jobPosting
      if (input.action === 'approve') {
        const department = await tx.get('departments', id(current.department))
        if (!department || department.isActive === false) throw manpowerError('The department is no longer active', 409)
        jobPosting = current._id
        await tx.create('jobpostings', {
          ...current.job, _id: jobPosting, jobCode: `MRF-${id(current._id).toUpperCase()}`,
          department: current.department, hiringManager: current.employee, createdBy: actor.employeeId || current.employee,
          status: 'open', publishedAt: now, createdAt: now, updatedAt: now, __v: 0,
          hiringPipeline: ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'].map((stageName, stageOrder) => ({ stageName, stageOrder })),
        })
      }
      const record = { ...current,
        status: input.action === 'approve' ? 'approved' : 'rejected', reviewedBy: actor._id, reviewedAt: now, reviewReason, ...(jobPosting ? { jobPosting } : {}),
        updatedAt: now, __v: Number(current.__v || 0) + 1,
      }
      await tx.replace('manpowerrequests', record)
      await tx.create('notifications', manpowerNotification({ key: `review:${id(current)}`, user: current.requestedBy, title: 'Manpower request reviewed', message: `${current.job.jobTitle}: ${record.status}${reviewReason ? ` — ${reviewReason}` : ''}`, now }))
      return { record, repeated: false }
  })
}

export const manpowerRecordId = key => createHash('sha256').update(key).digest('hex').slice(0, 24)

export function manpowerNotification({ key, user, title, message, now }) {
  return { _id: manpowerRecordId(key), user: id(user), title, message, type: 'recruitment', link: '/dashboard/recruitment/requisitions', url: '/dashboard/recruitment/requisitions', read: false, priority: 'medium', createdAt: now, updatedAt: now }
}

/** Deterministic IDs make retries atomic without a dynamically installed index. */
export async function submitManpower(store, actor, { job, justification, submissionKey }, reviewers) {
  const requestedBy = id(actor), requestId = manpowerRecordId(`request:${requestedBy}:${submissionKey}`)
  // Imported requests have their original IDs. Resolve those before creating a
  // new deterministic ID; the store's unique claim also protects races.
  const existing = await store.list('manpowerrequests', { filters: [{ field: 'requestedBy', operator: '==', value: requestedBy }, { field: 'submissionKey', operator: '==', value: submissionKey }], limit: 1 })
  if (existing.records.length) return existing.records[0]
  return store.transaction(async tx => {
    const previous = await tx.get('manpowerrequests', requestId)
    if (previous) return previous
    const employee = await tx.get('employees', id(actor.employeeId))
    const department = await tx.get('departments', job.department)
    if (!employee || ['inactive', 'terminated', 'resigned'].includes(employee.status)) throw manpowerError('Active employee profile required', 403)
    if (!department || department.isActive === false) throw manpowerError('Choose an active department')
    const validReviewers = (await Promise.all(reviewers.map(reviewer => tx.get('users', id(reviewer))))).filter(reviewer => reviewer && id(reviewer) !== requestedBy && isManpowerHr(reviewer) && reviewer.isActive !== false)
    if (!validReviewers.length) throw manpowerError('An independent HR/admin reviewer must be configured', 409)
    // One request plus bounded notifications must fit the atomic write budget.
    if (validReviewers.length > 45) throw manpowerError('Too many reviewers; configure a smaller HR review group', 409)
    const now = new Date()
    const record = { _id: requestId, requestedBy, employee: id(actor.employeeId), department: job.department, job, justification, submissionKey, status: 'pending', createdAt: now, updatedAt: now, __v: 0 }
    await tx.create('manpowerrequests', record)
    for (const reviewer of validReviewers) await tx.create('notifications', manpowerNotification({ key: `submit:${requestId}:${id(reviewer)}`, user: reviewer._id, title: 'Manpower request awaiting approval', message: `${job.numberOfPositions} × ${job.jobTitle}`, now }))
    return record
  })
}
