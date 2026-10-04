import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from './auth'
import { buildCachePattern, clearCachePattern } from './cache'
import { emitEvent, EVENTS } from './eventBus'
import { sendLeaveApprovedNotification, sendLeaveRejectedNotification } from './notificationService'
import { LEAVE_STORE_OPTIONS, listLeaveRequests, submitLeaveRequest, transitionLeaveRequest, populateLeaves } from './leaveRequests.server'

export async function afterChange(auth, record, response) {
  await Promise.all(['leave-balance', 'dashboard:unified', 'dashboard:employee-stats', 'dashboard:manager-stats', 'dashboard:hr-stats'].map(namespace => clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace, userId: '*' })).catch(() => {})))
  try {
    const users = (await auth.database.list('users', { filters: [{ field: 'employeeId', operator: '==', value: String(record.employee) }], limit: 2 })).records
    // No empty-target broadcasts: tenants can contain overlapping legacy IDs.
    if (users.length === 1) {
      if (['approved', 'rejected'].includes(record.status)) {
        const payload = { database: auth.database, leaveId: record._id, employeeId: users[0]._id, leaveType: response.leaveType?.name || response.requestLabel, startDate: new Date(record.startDate).toISOString().slice(0, 10), endDate: new Date(record.endDate).toISOString().slice(0, 10), approvedBy: record.approverUserId, rejectedBy: record.approverUserId, reason: record.rejectionReason }
        await (record.status === 'approved' ? sendLeaveApprovedNotification(payload) : sendLeaveRejectedNotification(payload))
      }
      await emitEvent(EVENTS.LEAVE_STATUS_CHANGED, { leaveId: record._id, status: record.status, employeeId: record.employee }, { userIds: [users[0]._id], databaseName: auth.tenant.databaseName })
    }
  } catch { console.error('[Leave] Post-commit notification needs retry') }
}
export async function handleLeaveRequest(request, { params, actionEndpoint = false, method = request.method } = {}) {
  try {
    const auth = await getAuthAndDatabase(request, LEAVE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    if (method === 'GET') return NextResponse.json({ success: true, data: await listLeaveRequests(auth.database, auth.user, new URL(request.url).searchParams) })
    let record
    if (method === 'POST') record = await submitLeaveRequest(auth.database, auth.user, await request.json())
    else {
      const { id } = await params
      const input = method === 'DELETE' ? {} : await request.json()
      const status = method === 'DELETE' ? 'cancelled' : actionEndpoint ? ({ approve: 'approved', reject: 'rejected' })[input.action] : input.status
      record = await transitionLeaveRequest(auth.database, auth.user, id, { status, reason: input.rejectionReason || input.reason || input.approvalComments || '' })
    }
    const data = (await populateLeaves(auth.database, [record]))[0]
    await afterChange(auth, record, data)
    return NextResponse.json({ success: true, message: method === 'POST' ? 'Request submitted successfully' : `Leave request ${record.status} successfully`, ...(method !== 'DELETE' ? { data } : {}) }, { status: method === 'POST' ? 201 : 200 })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to process leave request' }, { status: error.status || 500 }) }
}
