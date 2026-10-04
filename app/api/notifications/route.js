import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { INBOX_OPTIONS, listInbox, changeInbox } from '@/lib/notificationInbox.server'
async function handle(request, method) {
  try {
    const auth = await getAuthAndDatabase(request, INBOX_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const params = new URL(request.url).searchParams
    if (method === 'GET') return NextResponse.json({ success: true, ...await listInbox(auth.database, auth.user, params) })
    const body = method === 'PATCH' ? await request.json() : {}, remove = method === 'DELETE'
    const count = await changeInbox(auth.database, auth.user, remove ? { all: params.get('deleteAll') === 'true', ids: params.get('id') ? [params.get('id')] : [] } : { all: body.markAllAsRead === true, ids: body.notificationIds }, remove)
    return NextResponse.json({ success: true, message: `${count} notification(s) ${remove ? 'deleted' : 'marked as read'}` })
  } catch (error) { return NextResponse.json({ success: false, message: error.name === 'SyntaxError' ? 'Invalid request JSON' : error.status ? error.message : 'Could not process notifications' }, { status: error.name === 'SyntaxError' ? 400 : error.status || 500 }) }
}
export const GET = request => handle(request, 'GET')
export const PATCH = request => handle(request, 'PATCH')
export const DELETE = request => handle(request, 'DELETE')

