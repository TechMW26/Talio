import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from './auth'
import { ADMIN_OPERATION_OPTIONS, suspendedUsers, reactivateUser, broadcastRefresh, clearTenantChats, liveUsers, employeePresence } from './adminOperations.server'
export async function handleAdminOperation(request, kind) {
  try {
    const auth = await getAuthAndDatabase(request, ADMIN_OPERATION_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const { database, user } = auth
    if (kind === 'clear-chats') return NextResponse.json({ success: true, message: 'All chat data cleared successfully', ...await clearTenantChats(database, user) })
    if (kind === 'presence') return NextResponse.json({ employees: await employeePresence(database, (await request.json()).employeeIds || []) })
    let data
    if (kind === 'reactivate-user') data = request.method === 'GET' ? await suspendedUsers(database, user) : await reactivateUser(database, user, await request.json())
    if (kind === 'broadcast-refresh') data = await broadcastRefresh(database, user, await request.json())
    if (kind === 'live-users') data = await liveUsers(database, user)
    return NextResponse.json({ success: true, data, timestamp: new Date().toISOString() })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to process administrative request' }, { status: error.status || 500 }) }
}
