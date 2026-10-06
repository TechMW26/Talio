import { NextResponse } from 'next/server'
import { verifySuperAdmin } from '@/lib/superadminAuth'

export async function GET(request) {
  const auth = await verifySuperAdmin(request)
  if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
  const { id, email, name, permissions, lastLogin } = auth.superadmin
  return NextResponse.json({ success: true, superadmin: { id, email, name, permissions, lastLogin } })
}
