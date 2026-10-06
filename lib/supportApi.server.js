import { NextResponse, after } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { requirePermission } from '@/lib/permissions'
import { supportDatabase, listTickets, mutateTicket, populateTickets, listHolidays, saveHoliday } from '@/lib/supportStore.server'
import { financeFilter as filter, financeId as idOf } from '@/lib/finance.server'
import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { emitHelpdeskUpdate, emitHolidayUpdate, emitRealtimeEvent } from '@/lib/realtimeEvents'
import { sendPushToUser } from '@/lib/pushNotification'
import { emitEvent, EVENTS } from '@/lib/eventBus'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'
export async function supportApi(request, context, kind, method) {
  try {
    let auth
    const managedTicket = kind === 'tickets' && ['PUT', 'DELETE'].includes(method)
    if (managedTicket) { auth = await requirePermission('helpdesk_manage', method === 'DELETE' ? 'delete' : 'edit')(request, []); if (auth.denied) return auth.denied }
    else { auth = await getAuthAndDatabase(request); if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 }) }
    const database = await supportDatabase(auth), id = context ? (await context.params).id : null, params = new URL(request.url).searchParams
    if (method === 'GET') return NextResponse.json({ success: true, data: kind === 'holidays' ? await listHolidays(database, params, id) : await listTickets(database, auth.user, params, id) })
    const input = method === 'DELETE' ? {} : await request.json()
    if (managedTicket && Object.hasOwn(input, 'assignedTo')) { const assignment = await requirePermission('helpdesk_manage', 'assign')(request, []); if (assignment.denied) return assignment.denied }
    const record = kind === 'holidays' ? await saveHoliday(database, auth.user, input, id, method === 'DELETE') : await mutateTicket(database, auth.user, input, { id, operation: method === 'DELETE' ? 'delete' : kind === 'comments' ? 'comment' : 'save', permissionGranted: managedTicket })
    const data = kind === 'holidays' ? record : (await populateTickets(database, [record], auth.user))[0]
    const action = method === 'DELETE' ? 'delete' : kind === 'comments' ? 'commented' : id ? 'update' : 'create'
    after(async () => {
      try {
        if (kind === 'holidays') {
          await clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace: 'holidays' })).catch(() => {})
          const users = await collectFirestorePages(database, 'users', { filters: [filter('isActive', true)] })
          emitHolidayUpdate(record, { action, broadcast: false, userIds: users.map(user => user._id) })
          return
        }
        const employees = await readFirestoreReferences(database, 'employees', [record.createdBy, record.assignedTo])
        const internal = kind === 'comments' && record.comments?.at(-1)?.isInternal
        const relevantEmployees = [...employees.values()].filter(employee => !internal || employee._id === idOf(record.assignedTo)), recipients = new Set(relevantEmployees.map(employee => idOf(employee.userId)).filter(Boolean))
        if (relevantEmployees.length) for (const user of await collectFirestorePages(database, 'users', { filters: [filter('isActive', true), filter('employeeId', relevantEmployees.map(employee => employee._id), 'in')] })) recipients.add(user._id)
        for (const user of await collectFirestorePages(database, 'users', { filters: [filter('isActive', true), filter('role', ['admin', 'super_admin', 'hr'], 'in')] })) recipients.add(user._id)
        const userIds = [...recipients]
        // Never broadcast ticket contents or internal comments across tenants.
        const payload = { ticketId: record._id, ticketNumber: record.ticketNumber, status: record.status, action }
        emitHelpdeskUpdate(payload, userIds, { action, broadcast: false })
        emitRealtimeEvent('helpdesk-ticket', payload, { userIds, broadcast: false })
        await emitEvent(EVENTS.HELPDESK_TICKET_CHANGED, payload, { userIds, databaseName: auth.tenant.databaseName })
        if (method !== 'DELETE') await Promise.allSettled(userIds.filter(user => user !== idOf(auth.user._id)).map(user => sendPushToUser(user, { title: 'Helpdesk ticket updated', body: `Ticket #${record.ticketNumber} is ${action}` }, { database, clickAction: `/dashboard/helpdesk/${record._id}`, eventType: 'helpdesk_ticket', data: payload })))
      } catch (error) { console.error('[Support event]', error.message) }
    })
    return NextResponse.json({ success: true, message: kind === 'comments' ? 'Comment added successfully' : method === 'DELETE' ? 'Record deleted successfully' : id ? 'Record updated successfully' : 'Record created successfully', ...(method !== 'DELETE' ? { data } : {}) }, { status: !id && method === 'POST' ? 201 : 200 })
  } catch (error) { return NextResponse.json({ success: false, message: error.name === 'SyntaxError' ? 'Invalid request JSON' : error.status ? error.message : 'Could not process support request' }, { status: error.name === 'SyntaxError' ? 400 : error.status || 500 }) }
}
