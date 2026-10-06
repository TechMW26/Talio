import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getNativePasswordRepository } from '@/lib/platform/firestorePassword.server'
import { sendPasswordResetEmail } from '@/lib/mailer'
export async function POST(request, { params }) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    if (!['admin', 'hr'].includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Only Admin or HR can send password reset links' }, { status: 403 })
    const { userId } = await params
    const target = await auth.database.get('users', userId)
    if (!target) return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    if (!target.isActive) return NextResponse.json({ success: false, message: 'Cannot send reset link to deactivated user' }, { status: 400 })
    if (auth.user.role === 'hr' && ['admin', 'super_admin'].includes(target.role)) return NextResponse.json({ success: false, message: 'Only an admin can reset administrator credentials' }, { status: 403 })
    const repository = await getNativePasswordRepository(auth.tenant.databaseName)
    const issued = await repository.issue(userId, { ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown', userAgent: request.headers.get('user-agent') || 'unknown', windowMs: 3600000, maxRequests: 5, expiresInMs: 86400000 })
    if (!issued) return NextResponse.json({ success: false, message: 'Too many reset requests. Please try later.' }, { status: 429 })
    const employee = target.employeeId ? await auth.database.get('employees', String(target.employeeId)) : null
    const result = await sendPasswordResetEmail({ to: target.email, firstName: employee?.firstName || 'there', resetLink: (process.env.NEXTAUTH_URL || 'https://app.talio.in') + '/auth/reset-password/' + issued.token, expiresInMinutes: 1440 })
    if (!result.success) return NextResponse.json({ success: false, message: 'Failed to send reset email. Please try again.' }, { status: 502 })
    return NextResponse.json({ success: true, message: 'Password reset link sent. The link will expire in 24 hours.', data: { email: target.email, expiresAt: issued.expiresAt } })
  } catch (error) { return NextResponse.json({ success: false, message: 'Failed to send reset link' }, { status: 500 }) }
}
