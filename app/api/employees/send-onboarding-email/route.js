import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { getAuthAndDatabase } from '@/lib/auth'
import { getNativePasswordRepository } from '@/lib/platform/firestorePassword.server'
import { sendAndLogOnboardingEmail } from '@/lib/mailer'
import { encryptPassword, decryptPassword } from '@/lib/passwordEncryption'
import { ONBOARDING_STORE_OPTIONS } from '@/lib/onboardingEmails.server'
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, ONBOARDING_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    if (!['admin', 'hr'].includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    const { email, resetPassword = false } = await request.json()
    if (typeof email !== 'string' || !email.trim()) return NextResponse.json({ success: false, message: 'Email is required' }, { status: 400 })
    const filters = [{ field: 'email', operator: '==', value: email.trim().toLowerCase() }]
    const [employees, users] = await Promise.all([auth.database.list('employees', { filters, limit: 2 }), auth.database.list('users', { filters, limit: 2 })])
    if (employees.records.length !== 1 || users.records.length !== 1) return NextResponse.json({ success: false, message: 'Employee account not found or ambiguous' }, { status: 404 })
    const employee = employees.records[0], target = users.records[0]
    if (String(target.employeeId) !== String(employee._id) || !target.isActive) return NextResponse.json({ success: false, message: 'Employee account is inactive or inconsistent' }, { status: 409 })
    let password
    if (resetPassword) {
      password = randomBytes(12).toString('base64url') + '1!'
      await (await getNativePasswordRepository(auth.tenant.databaseName)).adminReset(auth.user._id, target._id, password, { encryptedOnboardingPassword: encryptPassword(password) })
    } else password = target.forcePasswordChange && target.encryptedOnboardingPassword ? decryptPassword(target.encryptedOnboardingPassword) : null
    if (!password) return NextResponse.json({ success: false, message: 'No valid onboarding credential is stored. Choose reset password to generate a new one.' }, { status: 409 })
    const [department, designation] = await Promise.all([
      employee.department ? auth.database.get('departments', String(employee.department)) : null,
      employee.designation ? auth.database.get('designations', String(employee.designation)) : null,
    ])
    const result = await sendAndLogOnboardingEmail({ database: auth.database, employeeId: employee._id, userId: target._id, to: target.email, email: target.email, firstName: employee.firstName, lastName: employee.lastName, password, employeeCode: employee.employeeCode, designation: designation?.title || employee.designationLevelName, department: department?.name, dateOfJoining: employee.dateOfJoining, triggeredBy: 'manual_retry', retriedBy: auth.user._id, forceEnabled: true })
    return NextResponse.json({ success: result.success, message: result.success ? 'Onboarding email sent successfully' : result.error, data: { emailLogId: result.emailLogId, passwordReset: Boolean(resetPassword) } }, { status: result.success ? 200 : 502 })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to send onboarding email' }, { status: error.status || 500 }) }
}
