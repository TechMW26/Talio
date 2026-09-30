import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { acceptAndStartExit } from '@/lib/hrms/resignationExit.server'
import { isFeatureEnabled } from '@/lib/planFeatures'
import { getAuthAndModels } from '@/lib/auth'
import { HR_ROLES, idOf, isHr, failure, reasonText, publicResignation, transition, resolveReviewers, notifyResignation } from '@/lib/hrms/resignation.server'

export const dynamic = 'force-dynamic'
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })
async function context(request) {
  const auth = await getAuthAndModels(request, ['ResignationRequest', 'Employee', 'User', 'Department', 'Notification'])
  if (!auth.success) throw failure(auth.message || 'Please sign in', auth.status || 401)
  const actor = await auth.models.User.findById(auth.user._id || auth.user.userId).select('_id role employeeId isActive').lean()
  if (!actor || actor.isActive === false) throw failure('Active account required', 403)
  return { ...auth, actor }
}
const visible = (record, actor) => idOf(record.requestedBy) === idOf(actor._id) || isHr(actor) || record.reviewers.some(id => idOf(id) === idOf(actor._id))
const failed = error => json({ success: false, message: error.code === 11000 ? 'An active resignation already exists. Refresh your profile.' : error.status ? error.message : 'Could not process resignation. Please retry.' }, error.code === 11000 ? 409 : error.status || 500)
export async function GET(request) {
  try {
    const { actor, models } = await context(request)
    const query = isHr(actor) ? {} : { $or: [{ requestedBy: actor._id }, { reviewers: actor._id }] }
    const records = await models.ResignationRequest.find(query).sort({ updatedAt: -1 }).limit(200).populate('employee', 'firstName lastName employeeCode').populate('timeline.actor', 'email').lean()
    return json({ success: true, data: records.map(r => publicResignation(r, actor)), canManageExits: isHr(actor), canSubmit: Boolean(actor.employeeId) })
  } catch (error) { return failed(error) }
}
export async function POST(request) {
  try {
    const { actor, models, companyFeatures } = await context(request)
    if (!isFeatureEnabled(companyFeatures, 'exitManagement')) throw failure('Exit management is disabled for this organisation', 403)
    let input
    try { input = await request.json() } catch { throw failure('Invalid request body') }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('Invalid request body')
    const hrUsers = (await models.User.find({ role: { $in: HR_ROLES }, isActive: { $ne: false } }).select('_id').lean()).map(u => u._id)
    let record
    if (input.action === 'submit') {
      if (!actor.employeeId) throw failure('An employee profile is required to resign', 403)
      if (!hrUsers.some(id => idOf(id) !== idOf(actor._id))) throw failure('An independent HR/admin reviewer must be configured before submitting', 409)
      const employee = await models.Employee.findById(actor.employeeId).select('_id status').lean()
      if (!employee || ['resigned', 'terminated', 'inactive'].includes(employee.status)) throw failure('An active employee profile is required', 403)
      const reason = reasonText(input.reason)
      await models.ResignationRequest.collection.createIndex({ employee: 1 }, { unique: true, partialFilterExpression: { active: true } })
      record = await models.ResignationRequest.create({ employee: employee._id, requestedBy: actor._id, reason, status: 'hr_review', active: true, version: 0, reviewers: [], timeline: [{ action: 'submit', actor: actor._id, at: new Date(), reason }] })
    } else {
      if (!mongoose.Types.ObjectId.isValid(input.id || '')) throw failure('Invalid resignation request')
      const current = await models.ResignationRequest.findById(input.id).lean()
      if (!current || !visible(current, actor)) throw failure('Request not found', 404)
      if (!Number.isInteger(input.version) || current.version !== input.version) throw failure('This request changed. Refresh before acting.', 409)
      const { update, event } = transition(current, actor, input)
      if (['approve', 'return', 'forward_negotiation'].includes(input.action)) {
        const employee = await models.Employee.findById(current.employee).lean()
        if (!employee) throw failure('Employee profile is unavailable', 409)
        update.reviewers = await resolveReviewers(models, employee, current.requestedBy)
        if (!update.reviewers.length) throw failure('Assign an active manager, TL or department head to this employee before forwarding.', 409)
      }
      record = input.action === 'accept' ? await acceptAndStartExit(models, current, input, update, event) : await models.ResignationRequest.findOneAndUpdate({ _id: current._id, version: input.version, status: current.status }, { $set: update, $inc: { version: 1 }, $push: { timeline: event } }, { new: true, runValidators: true }).lean()
      if (!record) throw failure('Another reviewer updated this request. Refresh before acting.', 409)
    }
    const notificationDelayed = await notifyResignation(models, record, hrUsers.filter(id => idOf(id) !== idOf(record.requestedBy)))
    return json({ success: true, message: notificationDelayed ? 'Saved. Some notifications could not be delivered; the request is available in the profile review inbox.' : 'Resignation request updated.', data: { id: idOf(record._id) } })
  } catch (error) { return failed(error) }
}
