import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { LEAVE_TYPE_STORE_OPTIONS, listLeaveTypes, saveLeaveType } from '@/lib/leaveTypes.server'
const failure = error => NextResponse.json({ success: false, message: error.code === 'ALREADY_EXISTS' ? 'Leave type name or code is already in use' : error.status ? error.message : 'Unable to load or save leave types' }, { status: error.status || (error.code === 'ALREADY_EXISTS' ? 409 : 500) })
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, LEAVE_TYPE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    return NextResponse.json({ success: true, data: await listLeaveTypes(auth.database) })
  } catch (error) { return failure(error) }
}
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, LEAVE_TYPE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    return NextResponse.json({ success: true, data: await saveLeaveType(auth.database, auth.user, await request.json()), message: 'Leave type created successfully' }, { status: 201 })
  } catch (error) { return failure(error) }
}

