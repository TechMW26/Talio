import { NextResponse, after } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { communicationDatabase, listCommunications, saveCommunication, acknowledgePolicy, readAnnouncement, populateCommunications, policyApplies, announcementApplies } from '@/lib/communicationsStore.server'
import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { financeFilter as filter, financeId as idOf } from '@/lib/finance.server'
import { sendPolicyNotification, sendAnnouncementNotification } from '@/lib/notificationService'
import { sendPushToUsers } from '@/lib/pushNotification'
import { emitPolicyUpdate, emitAnnouncementUpdate } from '@/lib/realtimeEvents'
import { isDirectReport } from '@/lib/teamScope'
async function deliver(database, collection, row, actor, action) {
  const users = await collectFirestorePages(database, 'users', { filters: [filter('isActive', true)] })
  const employees = await readFirestoreReferences(database, 'employees', users.map(user => user.employeeId))
  const recipients = users.filter(user => {
    const employee = employees.get(idOf(user.employeeId))
    if (collection === 'policies') return policyApplies(row, employee)
    if (row.status !== 'published') return false
    if (row.createdByRole === 'manager') return employee && (isDirectReport(employee, idOf(row.createdBy)) || employee._id === idOf(row.createdBy))
    return announcementApplies(row, employee)
  }).map(user => user._id)
  if (!recipients.length) return
  if (collection === 'policies') emitPolicyUpdate(row, { action, broadcast: false, userIds: recipients })
  else emitAnnouncementUpdate(row, { action, broadcast: false, userIds: recipients })
  if (action === 'delete') return
  if (action === 'create') {
    if (collection === 'policies') await sendPolicyNotification({ database, policyId: row._id, title: row.title, targetUserIds: recipients, createdBy: actor._id })
    else await sendAnnouncementNotification({ database, announcementId: row._id, title: row.title, content: row.content, targetUserIds: recipients, createdBy: actor._id })
  } else await sendPushToUsers(recipients, { title: collection === 'policies' ? 'Policy updated' : 'Announcement updated', body: row.title }, { database, clickAction: `/dashboard/${collection}`, eventType: `${collection}_update`, data: { recordId: row._id } })
}
export async function communicationsApi(request, context, collection, method) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const database = await communicationDatabase(auth), params = new URL(request.url).searchParams, id = context ? (await context.params).id : null
    if (method === 'GET') {
      if (id) return NextResponse.json({ success: true, data: await readAnnouncement(database, auth.user, id) })
      return NextResponse.json({ success: true, ...await listCommunications(database, auth.user, collection, params) })
    }
    const body = method === 'DELETE' ? {} : await request.json()
    if (method === 'ACKNOWLEDGE') {
      await acknowledgePolicy(database, auth.user, id, body, String(request.headers.get('x-forwarded-for') || 'unknown').slice(0, 200))
      return NextResponse.json({ success: true, message: 'Policy acknowledged successfully' })
    }
    const row = await saveCommunication(database, auth.user, collection, body, id, method === 'DELETE')
    after(async () => { try { await deliver(database, collection, row, auth.user, method === 'DELETE' ? 'delete' : id ? 'update' : 'create') } catch (error) { console.error('[Communication delivery]', error.message) } })
    return NextResponse.json({ success: true, message: method === 'DELETE' ? 'Record deleted successfully' : 'Record saved successfully', ...(method === 'DELETE' ? {} : { data: (await populateCommunications(database, [row]))[0] }) }, { status: !id && method === 'POST' ? 201 : 200 })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Could not process communication request' }, { status: error.status || 500 }) }
}
