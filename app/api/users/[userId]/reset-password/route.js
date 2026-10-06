import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getNativePasswordRepository } from '@/lib/platform/firestorePassword.server'
import { encryptPassword } from '@/lib/passwordEncryption'
export async function POST(request, { params }) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    if (!['admin', 'hr'].includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Only Admin or HR can reset passwords' }, { status: 403 })
    const { userId } = await params, { newPassword } = await request.json()
    const repository = await getNativePasswordRepository(auth.tenant.databaseName)
    const target = await repository.adminReset(auth.user._id, userId, newPassword, { encryptedOnboardingPassword: encryptPassword(newPassword) })
    const employee = target.employeeId ? await auth.database.get('employees', String(target.employeeId)) : null
    const name = employee ? [employee.firstName, employee.lastName].filter(Boolean).join(' ') : target.email
    return NextResponse.json({ success: true, message: 'Password reset successfully for ' + name + '. User will be required to change password on next login.', data: { email: target.email, forcePasswordChange: true } })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to reset password' }, { status: error.status || 500 }) }
}
