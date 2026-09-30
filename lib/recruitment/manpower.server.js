import mongoose from 'mongoose'

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
export async function reviewManpower(models, actor, input) {
  if (!isManpowerHr(actor)) throw manpowerError('Only HR or admins may review requests', 403)
  if (!mongoose.Types.ObjectId.isValid(input.id || '') || !['approve', 'reject'].includes(input.action)) throw manpowerError('Invalid review')
  const reviewReason = input.action === 'reject' ? text(input.reason, 'Rejection reason', 2000, 5) : ''
  const session = await models.ManpowerRequest.db.startSession()
  let result
  try {
    await session.withTransaction(async () => {
      const current = await models.ManpowerRequest.findById(input.id).session(session).lean()
      if (!current) throw manpowerError('Request not found', 404)
      if (id(current.requestedBy) === id(actor._id)) throw manpowerError('Another HR/admin must review your request', 403)
      if (current.status === 'approved' && input.action === 'approve') { result = { record: current, repeated: true }; return }
      if (current.status !== 'pending') throw manpowerError('This request has already been reviewed. Refresh the list.', 409)
      const now = new Date()
      let jobPosting
      if (input.action === 'approve') {
        const department = await models.Department.findById(current.department).session(session).lean()
        if (!department || department.isActive === false) throw manpowerError('The department is no longer active', 409)
        jobPosting = current._id
        await models.JobPosting.create([{
          ...current.job, _id: jobPosting, jobCode: `MRF-${id(current._id).toUpperCase()}`,
          department: current.department, hiringManager: current.employee, createdBy: actor.employeeId || current.employee,
          status: 'open', publishedAt: now,
          hiringPipeline: ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'].map((stageName, stageOrder) => ({ stageName, stageOrder })),
        }], { session })
      }
      const record = await models.ManpowerRequest.findOneAndUpdate({ _id: current._id, status: 'pending' }, { $set: {
        status: input.action === 'approve' ? 'approved' : 'rejected', reviewedBy: actor._id, reviewedAt: now, reviewReason, ...(jobPosting ? { jobPosting } : {}),
      } }, { new: true, session, runValidators: true }).lean()
      if (!record) throw manpowerError('This request changed. Refresh and retry.', 409)
      await models.Notification.create([{ user: current.requestedBy, title: 'Manpower request reviewed', message: `${current.job.jobTitle}: ${record.status}${reviewReason ? ` — ${reviewReason}` : ''}`, type: 'recruitment', link: '/dashboard/manpower-requests' }], { session })
      result = { record, repeated: false }
    })
    return result
  } finally { await session.endSession() }
}
