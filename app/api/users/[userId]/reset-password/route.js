import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { jwtVerify } from 'jose'
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

/**
 * POST - Admin/HR directly reset user password
 * 
 * This IMMEDIATELY changes the user's password to the new password provided.
 * The user will NOT be able to login with their old password after this.
 * User will be required to change password on next login (forcePasswordChange: true).
 * 
 * For sending a reset LINK instead (without changing password), use:
 * POST /api/users/[userId]/send-reset-link
 */
export async function POST(request, { params }) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.split(' ')[1]

    // Verify the token
    let payload
    try {
      const verified = await jwtVerify(token, JWT_SECRET)
      payload = verified.payload
    } catch (error) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 401 }
      )
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee } = models

    // Verify requesting user is admin or HR
    const requestingUser = await User.findById(payload.userId).select('role')
    
    if (!requestingUser || !['admin', 'hr'].includes(requestingUser.role)) {
      return NextResponse.json(
        { success: false, message: 'Only Admin or HR can reset passwords' },
        { status: 403 }
      )
    }

    const { userId } = params
    const { newPassword } = await request.json()

    // Validate new password
    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json(
        { success: false, message: 'Password must be at least 6 characters long' },
        { status: 400 }
      )
    }

    // Find the user to reset password for
    const targetUser = await User.findById(userId).select('+password email role')

    if (!targetUser) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      )
    }

    // Update password and set forcePasswordChange to true
    targetUser.password = newPassword // Will be hashed by pre-save hook
    targetUser.forcePasswordChange = true
    await targetUser.save()

    // Get employee name for response
    let employeeName = targetUser.email
    if (targetUser.employeeId) {
      const employee = await Employee.findById(targetUser.employeeId).select('firstName lastName')
      if (employee) {
        employeeName = `${employee.firstName} ${employee.lastName}`
      }
    }

    return NextResponse.json({
      success: true,
      message: `Password reset successfully for ${employeeName}. User will be required to change password on next login.`,
      data: {
        email: targetUser.email,
        forcePasswordChange: true
      }
    })

  } catch (error) {
    console.error('[Reset Password] Error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to reset password' },
      { status: 500 }
    )
  }
}
