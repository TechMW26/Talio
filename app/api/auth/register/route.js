import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { provisionFirestoreAccount } from '@/lib/platform/firestoreProvisioning.server'
import { clearTenantCache } from '@/lib/tenantContext'

export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const { user } = await provisionFirestoreAccount(await request.json(), { actor: { ...auth.user, databaseName: auth.tenant.databaseName } })
    clearTenantCache(user.email)
    return NextResponse.json({ success: true, message: 'User registered successfully', user: { id: user._id, email: user.email, role: user.role } }, { status: 201 })
  } catch (error) {
    console.error('[Register] Failed:', error.code || error.name)
    return NextResponse.json({ message: error.status ? error.message : 'Unable to register this account' }, { status: error.status || 500 })
  }
}

