import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { listOnboardingPasswords } from '@/lib/employeePasswords.server'

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const result = await listOnboardingPasswords(auth.database, auth.user, new URL(request.url).searchParams, {
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'), userAgent: request.headers.get('user-agent'),
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to access onboarding passwords', ...(error.passwordStatus ? { passwordStatus: error.passwordStatus } : {}) }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
