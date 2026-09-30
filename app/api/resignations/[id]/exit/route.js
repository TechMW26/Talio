import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getAuthAndModels } from '@/lib/auth'
import { failure, idOf, isHr } from '@/lib/hrms/resignation.server'
import { startResignationExit, finaliseExit, emailExitDocument } from '@/lib/hrms/resignationExit.server'
import { validateSettlement } from '@/lib/hrms/settlement'
import { loadOffboardingAssetClearance } from '@/lib/hrms/offboardingAssets.server'
import { clearCachePattern, buildCachePattern } from '@/lib/cache'
import { isFeatureEnabled } from '@/lib/planFeatures'
import queryCache from '@/lib/queryCache'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
const failed = error => json({ success: false, message: error.status ? error.message : 'Could not update exit. Refresh to check the latest status before retrying.' }, error.status || 500)
async function context(request, params) {
  const { id } = await params
  if (!mongoose.Types.ObjectId.isValid(id)) throw failure('Invalid request', 400)
  const auth = await getAuthAndModels(request, ['ResignationRequest', 'Employee', 'User', 'UserSession', 'Asset', 'Document', 'Company', 'CompanySettings', 'SystemPreferences'])
  if (!auth.success) throw failure(auth.message || 'Please sign in', auth.status || 401)
  const actor = await auth.models.User.findById(auth.user._id || auth.user.userId).select('_id role employeeId isActive').lean()
  if (!actor || actor.isActive === false) throw failure('Active account required', 403)
  const record = await auth.models.ResignationRequest.findById(id).lean()
  if (!record || (!isHr(actor) && idOf(record.requestedBy) !== idOf(actor._id))) throw failure('Exit not found', 404)
  return { auth, actor, record }
}
async function invalidate(auth) {
  queryCache.clearPattern('employee')
  await Promise.all(['auth:user', 'employee:detail'].map(namespace => clearCachePattern(buildCachePattern({ tenantId: auth.tenant?.databaseName, namespace })).catch(() => {})))
}
export async function GET(request, { params }) {
  try {
    const { auth, actor, record } = await context(request, params)
    const employee = await auth.models.Employee.findById(record.employee).lean()
    if (!employee) throw failure('Employee not found', 404)
    const clearance = await loadOffboardingAssetClearance({ Asset: auth.models.Asset, employeeId: employee._id, offboarding: employee.lifecycle?.offboarding })
    const document = record.exitDocument ? await auth.models.Document.findById(record.exitDocument).select('_id fileName emailDelivery').lean() : null
    return json({ success: true, data: { status: record.status, version: record.version, employeeId: idOf(employee._id), lastWorkingDate: record.proposal?.lastWorkingDate, started: idOf(clearance.offboarding.resignationRequest) === idOf(record._id), settlement: clearance.offboarding.settlement || null, assets: clearance.summary, document, canManage: isHr(actor) && idOf(record.requestedBy) !== idOf(actor._id) } })
  } catch (error) { return failed(error) }
}
export async function POST(request, { params }) {
  try {
    const { auth, actor, record } = await context(request, params)
    if (!isHr(actor) || idOf(record.requestedBy) === idOf(actor._id)) throw failure('An independent HR/admin must manage this exit', 403)
    if (!isFeatureEnabled(auth.companyFeatures, 'exitManagement')) throw failure('Exit management is disabled for this organisation', 403)
    let input
    try { input = await request.json() } catch { throw failure('Invalid request body') }
    if (!input || !['start', 'save_settlement', 'finalise', 'send_documents'].includes(input.action)) throw failure('Invalid exit action')
    // A repeated completion only checks delivery; it never repeats the settlement or creates a second PDF.
    if (record.status === 'completed' && ['finalise', 'send_documents'].includes(input.action)) {
      await invalidate(auth)
      const email = await emailExitDocument(auth.models, record.exitDocument)
      return json({ success: true, message: email?.status === 'sent' ? 'Exit completed. Documents sent by email.' : `Exit completed. Email status: ${email?.status || 'not_sent'}.`, email })
    }
    if (record.status !== 'accepted') throw failure('The employee must accept the notice period first', 409)
    if (!Number.isInteger(input.version) || input.version !== record.version) throw failure('Request changed. Refresh before acting.', 409)
    if (input.action === 'send_documents') throw failure('Finalise the exit before sending documents')
    if (input.action === 'finalise') {
      const documentId = await finaliseExit(auth, actor, record, input)
      await invalidate(auth)
      // Persisted completion remains successful if the mail service is unavailable.
      let email
      try { email = await emailExitDocument(auth.models, documentId) } catch { email = { status: 'not_sent' } }
      return json({ success: true, message: email.status === 'sent' ? 'Employee marked Resigned. Documents sent by email.' : 'Employee marked Resigned. Review the document email status below.', email })
    }
    let settlement
    if (input.action === 'save_settlement') {
      try { settlement = validateSettlement(input.settlement) } catch (error) { throw failure(error.message) }
    }
    const session = await auth.models.ResignationRequest.db.startSession()
    try {
      await session.withTransaction(async () => {
        const employee = await auth.models.Employee.findById(record.employee).session(session).lean()
        if (!employee) throw failure('Employee not found', 404)
        const lifecycle = startResignationExit(employee, record)
        if (settlement) { lifecycle.offboarding.settlement = { ...settlement, savedAt: new Date(), savedBy: actor._id }; lifecycle.offboarding.fullAndFinalStatus = 'pending' }
        const changed = await auth.models.ResignationRequest.updateOne({ _id: record._id, version: input.version, status: 'accepted' }, { $inc: { version: 1 }, $push: { timeline: { action: input.action, actor: actor._id, at: new Date(), reason: settlement ? 'HR saved the full-and-final calculation' : 'HR started offboarding' } } }, { session })
        if (changed.modifiedCount !== 1) throw failure('Request changed. Refresh before acting.', 409)
        await auth.models.Employee.updateOne({ _id: employee._id }, { $set: { lifecycle }, $inc: { __v: 1 } }, { session, runValidators: true })
      })
    } finally { await session.endSession() }
    await invalidate(auth)
    return json({ success: true, message: settlement ? 'Settlement calculation saved. Payment has not been marked complete.' : 'Offboarding started.' })
  } catch (error) { return failed(error) }
}
