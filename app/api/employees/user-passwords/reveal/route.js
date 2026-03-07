import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { decryptPassword } from '@/lib/passwordEncryption'

/**
 * POST - Reveal the full decrypted onboarding password for a specific user
 * 
 * SECURITY:
 * - Only admin and HR roles can call this
 * - Every call is audit-logged (who revealed whose password, when, from where)
 * - Only works for users who still have an encrypted onboarding password
 * - Users who have changed their password will return a "changed" status
 * 
 * Request body: { userId: string }
 * Response: { success: true, password: string } or error
 */
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'PasswordAuditLog'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee, PasswordAuditLog } = models

    // RBAC: Only admin and HR
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Access denied. Only Admin and HR can reveal passwords.' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { userId, action } = body

    if (!userId) {
      return NextResponse.json(
        { success: false, message: 'userId is required' },
        { status: 400 }
      )
    }

    // Find the target user with the encrypted field
    const targetUser = await User.findById(userId, {
      email: 1,
      encryptedOnboardingPassword: 1,
      forcePasswordChange: 1,
      employeeId: 1,
    }).lean()

    if (!targetUser) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      )
    }

    // Check if user has changed their password
    if (!targetUser.forcePasswordChange && !targetUser.encryptedOnboardingPassword) {
      return NextResponse.json({
        success: false,
        message: 'Password changed by user — onboarding password is no longer available',
        passwordStatus: 'changed_by_user',
      }, { status: 410 })
    }

    // Decrypt the password
    if (!targetUser.encryptedOnboardingPassword) {
      return NextResponse.json({
        success: false,
        message: 'No onboarding password available for this user',
        passwordStatus: 'not_available',
      }, { status: 404 })
    }

    const decrypted = decryptPassword(targetUser.encryptedOnboardingPassword)
    
    if (!decrypted) {
      return NextResponse.json({
        success: false,
        message: 'Failed to decrypt password — encryption key may have changed',
        passwordStatus: 'decryption_failed',
      }, { status: 500 })
    }

    // Audit log: record the reveal action
    const auditAction = action === 'copy_credentials' ? 'copy_credentials' 
                       : action === 'copy' ? 'copy_password' 
                       : 'view_password'
    
    try {
      await PasswordAuditLog.create({
        action: auditAction,
        performedBy: user._id || user.userId,
        performedByEmail: user.email,
        performedByRole: user.role,
        targetUser: targetUser._id,
        targetUserEmail: targetUser.email,
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
        userAgent: request.headers.get('user-agent') || 'unknown',
        metadata: { action: auditAction },
      })
    } catch (auditError) {
      // Don't fail the request if audit logging fails
      console.error('[RevealPassword] Audit log error:', auditError.message)
    }

    return NextResponse.json({
      success: true,
      password: decrypted,
      email: targetUser.email,
    })
  } catch (error) {
    console.error('Reveal password error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to reveal password' },
      { status: 500 }
    )
  }
}
