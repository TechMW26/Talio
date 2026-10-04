import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { normalizeLeaveType } from '@/lib/leaveData'
import { LEAVE_TYPE_STORE_OPTIONS, assertLeaveTypeId, saveLeaveType, deleteLeaveType } from '@/lib/leaveTypes.server'
const failure = error => NextResponse.json({ success: false, message: error.code === 'ALREADY_EXISTS' ? 'Leave type name or code is already in use' : error.status ? error.message : 'Unable to load or save leave type' }, { status: error.status || (error.code === 'ALREADY_EXISTS' ? 409 : 500) })
async function handle(request, params, method) {
  try {
    const auth = await getAuthAndDatabase(request, LEAVE_TYPE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const { id } = await params
    assertLeaveTypeId(id)
    if (method === 'DELETE') {
      await deleteLeaveType(auth.database, auth.user, id)
      return NextResponse.json({ success: true, message: 'Leave type deleted successfully' })
    }
    const data = method === 'PUT' ? await saveLeaveType(auth.database, auth.user, await request.json(), id) : await auth.database.get('leavetypes', id)
    if (!data) return NextResponse.json({ success: false, message: 'Leave type not found' }, { status: 404 })
    return NextResponse.json({ success: true, data: normalizeLeaveType(data), ...(method === 'PUT' ? { message: 'Leave type updated successfully' } : {}) })
  } catch (error) { return failure(error) }
}
export const GET = (request, { params }) => handle(request, params, 'GET')
export const PUT = (request, { params }) => handle(request, params, 'PUT')
export const DELETE = (request, { params }) => handle(request, params, 'DELETE')

