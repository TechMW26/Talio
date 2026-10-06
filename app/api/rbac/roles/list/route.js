import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ROLE_STORE_OPTIONS, listNativeRoles } from '@/lib/platform/firestoreRoles.server'
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, ROLE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const roles = await listNativeRoles(auth.database)
    return NextResponse.json({ success: true, data: roles.map(({ _id, name, displayLabel, isSystemRole, description }) => ({ _id, name, displayLabel, isSystemRole, description })) })
  } catch (error) { return NextResponse.json({ success: false, message: 'Failed to fetch roles' }, { status: 500 }) }
}
