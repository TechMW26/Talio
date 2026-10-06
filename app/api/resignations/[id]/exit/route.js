import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { failure, idOf, isHr } from '@/lib/hrms/resignation.server'
import { startResignationExit, finaliseExit, emailExitDocument } from '@/lib/hrms/resignationExit.server'
import { validateSettlement } from '@/lib/hrms/settlement'
import { getResignationStore, loadExitAssets } from '@/lib/hrms/resignationStore.server'
import { clearCachePattern, buildCachePattern } from '@/lib/cache'
import { isFeatureEnabled } from '@/lib/planFeatures'
import queryCache from '@/lib/queryCache'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
const failed = error => json({ success: false, message: error.status ? error.message : 'Could not update exit. Refresh to check the latest status before retrying.' }, error.status || 500)
async function context(request, params) {
  const { id } = await params
  if (!/^[a-f\d]{24}$/i.test(id || '')) throw failure('Invalid request', 400)
  const auth = await getAuthAndDatabase(request)
  if (!auth.success) throw failure(auth.message || 'Please sign in', auth.status || 401)
  const store = await getResignationStore(auth)
  const actor = await store.get('users', idOf(auth.user._id || auth.user.userId))
  if (!actor || actor.isActive === false) throw failure('Active account required', 403)
  const record = await store.get('resignationrequests', id)
  if (!record || (!isHr(actor) && idOf(record.requestedBy) !== idOf(actor._id))) throw failure('Exit not found', 404)
  return { auth, actor, record, store }
}
async function invalidate(auth) {
  queryCache.clearPattern('employee')
  await Promise.all(['auth:user', 'employee:detail'].map(namespace => clearCachePattern(buildCachePattern({ tenantId: auth.tenant?.databaseName, namespace })).catch(() => {})))
}
export async function GET(request, { params }) {
  try {
    const { auth, actor, record, store } = await context(request, params)
    const employee = await store.get('employees', idOf(record.employee))
    if (!employee) throw failure('Employee not found', 404)
    const clearance = await loadExitAssets(store, employee)
    const storedDocument = record.exitDocument ? await store.get('documents', idOf(record.exitDocument)) : null
    const document = storedDocument ? { _id: storedDocument._id, fileName: storedDocument.fileName, emailDelivery: storedDocument.emailDelivery } : null
    return json({ success: true, data: { status: record.status, version: record.version, employeeId: idOf(employee._id), lastWorkingDate: record.proposal?.lastWorkingDate, started: idOf(clearance.offboarding.resignationRequest) === idOf(record._id), settlement: clearance.offboarding.settlement || null, assets: clearance.summary, document, canManage: isHr(actor) && idOf(record.requestedBy) !== idOf(actor._id) } })
  } catch (error) { return failed(error) }
}
export async function POST(request, { params }) {
  try {
    const { auth, actor, record, store } = await context(request, params)
    if (!isHr(actor) || idOf(record.requestedBy) === idOf(actor._id)) throw failure('An independent HR/admin must manage this exit', 403)
    if (!isFeatureEnabled(auth.companyFeatures, 'exitManagement')) throw failure('Exit management is disabled for this organisation', 403)
    let input
    try { input = await request.json() } catch { throw failure('Invalid request body') }
    if (!input || !['start', 'save_settlement', 'finalise', 'send_documents'].includes(input.action)) throw failure('Invalid exit action')
    // A repeated completion only checks delivery; it never repeats the settlement or creates a second PDF.
    if (record.status === 'completed' && ['finalise', 'send_documents'].includes(input.action)) {
      await invalidate(auth)
      const email = await emailExitDocument(store, record.exitDocument)
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
      try { email = await emailExitDocument(store, documentId) } catch { email = { status: 'not_sent' } }
      return json({ success: true, message: email.status === 'sent' ? 'Employee marked Resigned. Documents sent by email.' : 'Employee marked Resigned. Review the document email status below.', email })
    }
    let settlement
    if (input.action === 'save_settlement') {
      try { settlement = validateSettlement(input.settlement) } catch (error) { throw failure(error.message) }
    }
    await store.transaction(async tx => {
      const [employee, latest] = await Promise.all([tx.get('employees', idOf(record.employee)), tx.get('resignationrequests', idOf(record))])
      if (!employee) throw failure('Employee not found', 404)
      if (!latest || latest.version !== input.version || latest.status !== 'accepted') throw failure('Request changed. Refresh before acting.', 409)
      const lifecycle = startResignationExit(employee, latest)
      const now = new Date()
      if (settlement) { lifecycle.offboarding.settlement = { ...settlement, savedAt: now, savedBy: actor._id }; lifecycle.offboarding.fullAndFinalStatus = 'pending' }
      await tx.replace('resignationrequests', { ...latest, version: latest.version + 1, updatedAt: now, timeline: [...(latest.timeline || []), { action: input.action, actor: actor._id, at: now, reason: settlement ? 'HR saved the full-and-final calculation' : 'HR started offboarding' }] })
      await tx.replace('employees', { ...employee, lifecycle, __v: Number(employee.__v || 0) + 1, updatedAt: now })
    })
    await invalidate(auth)
    return json({ success: true, message: settlement ? 'Settlement calculation saved. Payment has not been marked complete.' : 'Offboarding started.' })
  } catch (error) { return failed(error) }
}
