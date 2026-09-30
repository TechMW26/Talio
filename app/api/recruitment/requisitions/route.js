import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { emitRecruitmentUpdate } from '@/lib/realtimeEvents'
import { HR_ROLES, canRequestManpower, isManpowerHr, manpowerError, validateManpower, reviewManpower } from '@/lib/recruitment/manpower.server'

export const dynamic = 'force-dynamic'
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
async function context(request) {
  const auth = await getAuthAndModels(request, ['ManpowerRequest', 'JobPosting', 'User', 'Employee', 'Department', 'Notification'])
  if (!auth.success) throw manpowerError(auth.message || 'Sign in required', auth.status || 401)
  const actor = await auth.models.User.findById(auth.user._id || auth.user.userId).select('_id role employeeId isActive isDepartmentHead isDepartmentManager teamLeaderOf').lean()
  if (!actor || actor.isActive === false) throw manpowerError('Active account required', 403)
  if (!canRequestManpower(actor) && actor.employeeId) {
    const leadership = await auth.models.Department.exists({ isActive: { $ne: false }, $or: [
      { head: actor.employeeId }, { heads: actor.employeeId }, { departmentManager: actor.employeeId }, { departmentManagers: actor.employeeId },
    ] })
    if (leadership) actor.isDepartmentHead = true
  }
  if (!canRequestManpower(actor)) throw manpowerError('Leadership or HR access is required', 403)
  return { actor, models: auth.models }
}
const failed = error => json({ success: false, message: error.status ? error.message : 'Could not save this request. Refresh and retry.' }, error.status || 500)
export async function GET(request) {
  try {
    const { actor, models } = await context(request)
    const url = new URL(request.url)
    const page = Math.floor(Math.max(1, Math.min(10000, Number(url.searchParams.get('page')) || 1)))
    const scope = isManpowerHr(actor) ? {} : { requestedBy: actor._id }
    const status = url.searchParams.get('status') || 'all'
    if (!['all', 'pending', 'approved', 'rejected'].includes(status)) throw manpowerError('Invalid request status')
    const filter = status === 'all' ? scope : { ...scope, status }
    const [data, total, departments, pending, approved, rejected] = await Promise.all([
      models.ManpowerRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).populate('employee', 'firstName lastName employeeCode').populate('department', 'name').lean(),
      models.ManpowerRequest.countDocuments(filter),
      models.Department.find({ isActive: { $ne: false } }).select('_id name').sort({ name: 1 }).lean(),
      models.ManpowerRequest.countDocuments({ ...scope, status: 'pending' }),
      models.ManpowerRequest.countDocuments({ ...scope, status: 'approved' }),
      models.ManpowerRequest.countDocuments({ ...scope, status: 'rejected' }),
    ])
    return json({ success: true, data: data.map(record => ({ ...record, canReview: isManpowerHr(actor) && String(record.requestedBy) !== String(actor._id) && record.status === 'pending' })), departments, total, page, stats: { all: pending + approved + rejected, pending, approved, rejected }, isHr: isManpowerHr(actor), canSubmit: Boolean(actor.employeeId) })
  } catch (error) { return failed(error) }
}
export async function POST(request) {
  try {
    const { actor, models } = await context(request)
    let input
    try { input = await request.json() } catch { throw manpowerError('Invalid request body') }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw manpowerError('Invalid request body')
    if (input.action !== 'submit') {
      const { record, repeated } = await reviewManpower(models, actor, input)
      if (record.jobPosting && !repeated) {
        try { const job = await models.JobPosting.findById(record.jobPosting).populate('department', 'name').lean(); emitRecruitmentUpdate(job, { action: 'create' }) } catch { /* Saved job remains available to refresh and connector sync. */ }
      }
      return json({ success: true, data: record, message: record.status === 'approved' ? 'Approved and published in Talio. Configured recruitment connectors will pick up the job on their next sync.' : 'Request rejected and requester notified.' })
    }
    if (!actor.employeeId) throw manpowerError('An employee profile is required to submit', 403)
    if (typeof input.submissionKey !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(input.submissionKey)) throw manpowerError('Invalid submission key. Reload the form.')
    const { job, justification } = validateManpower(input)
    const [employee, department, reviewers] = await Promise.all([
      models.Employee.findById(actor.employeeId).select('_id status').lean(),
      models.Department.findById(job.department).select('_id isActive').lean(),
      models.User.find({ _id: { $ne: actor._id }, role: { $in: HR_ROLES }, isActive: { $ne: false } }).select('_id').lean(),
    ])
    if (!employee || ['inactive', 'terminated', 'resigned'].includes(employee.status)) throw manpowerError('Active employee profile required', 403)
    if (!department || department.isActive === false) throw manpowerError('Choose an active department')
    if (!reviewers.length) throw manpowerError('An independent HR/admin reviewer must be configured', 409)
    // Tenant production connections disable autoIndex. Install the idempotency
    // constraint before accepting requests, including concurrent browser retries.
    await models.ManpowerRequest.collection.createIndex({ requestedBy: 1, submissionKey: 1 }, { unique: true })
    const session = await models.ManpowerRequest.db.startSession()
    let record
    try {
      await session.withTransaction(async () => {
        record = await models.ManpowerRequest.findOne({ requestedBy: actor._id, submissionKey: input.submissionKey }).session(session).lean()
        if (record) return
        ;[record] = await models.ManpowerRequest.create([{ requestedBy: actor._id, employee: actor.employeeId, department: job.department, job, justification, submissionKey: input.submissionKey }], { session })
        await models.Notification.create(reviewers.map(reviewer => ({ user: reviewer._id, title: 'Manpower request awaiting approval', message: `${job.numberOfPositions} × ${job.jobTitle}`, type: 'recruitment', link: '/dashboard/recruitment/requisitions' })), { session })
      })
    } catch (error) {
      if (error.code !== 11000) throw error
      record = await models.ManpowerRequest.findOne({ requestedBy: actor._id, submissionKey: input.submissionKey }).lean()
      if (!record) throw error
    } finally { await session.endSession() }
    return json({ success: true, data: { id: record._id }, message: 'Request submitted to HR.' })
  } catch (error) { return failed(error) }
}
