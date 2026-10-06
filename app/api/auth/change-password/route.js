import { NextResponse } from 'next/server'
import { verifyTokenFromRequest } from '@/lib/auth'
import { getNativeAuthRepository } from '@/lib/platform/firestoreAuth.server'
import { getNativePasswordRepository } from '@/lib/platform/firestorePassword.server'
import { compareStoredPassword } from '@/lib/passwordAuth'

export async function POST(request) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized - No token provided' },
        { status: 401 }
      )
    }

    const token = authHeader.split(' ')[1]

    // Verify the token
    let payload
    try {
      const auth = await verifyTokenFromRequest(request)
      if (!auth.success) throw new Error('Invalid session')
      payload = auth.user
    } catch (error) {
      return NextResponse.json(
        { success: false, message: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    if (!payload || !payload.userId) {
      return NextResponse.json(
        { success: false, message: 'Invalid token payload' },
        { status: 401 }
      )
    }

    // SECURITY: Require tenant context from JWT
    if (!payload.databaseName) {
      return NextResponse.json(
        { success: false, message: 'Invalid session - please log in again' },
        { status: 401 }
      )
    }

    // Get tenant-specific models
    const repository = await getNativeAuthRepository(payload.databaseName)
    const passwords = await getNativePasswordRepository(payload.databaseName)

    // Get request body
    const body = await request.json().catch(() => ({}))
    const { currentPassword, newPassword } = body

    // Validate input
    if (!currentPassword || !newPassword || typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Current password and new password are required' },
        { status: 400 }
      )
    }

    // Password validation rules
    if (newPassword.length < 8) {
      return NextResponse.json(
        { success: false, message: 'New password must be at least 8 characters long' },
        { status: 400 }
      )
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { success: false, message: 'New password must be different from current password' },
        { status: 400 }
      )
    }

    // Find user with password field (isActive and forcePasswordChange are included by default)
    let user = await repository.database.get('users', String(payload.userId))

    if (!user) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      )
    }

    if (!user.isActive) {
      return NextResponse.json(
        { success: false, message: 'Account has been deactivated' },
        { status: 401 }
      )
    }

    // Verify current password even if the loaded model instance lacks schema methods.
    const isPasswordMatch = await compareStoredPassword(currentPassword, user.password)

    if (!isPasswordMatch) {
      return NextResponse.json(
        { success: false, message: 'Current password is incorrect' },
        { status: 400 }
      )
    }

    user = await passwords.change(user._id, currentPassword, newPassword)
    const updatedUser = user

    // Fetch employee data for response
    let employeeData = null
    if (user.employeeId) {
      try {
        employeeData = await repository.getEmployee(user.employeeId)
      } catch (error) {
        console.error('Error fetching employee data:', error)
      }
    }

    // Prepare updated user data for frontend
    const userData = {
      id: user._id.toString(),
      _id: user._id.toString(),
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      forcePasswordChange: false,
      // Profile completion status for modal display
      profileCompletion: updatedUser?.profileCompletion ? {
        status: updatedUser.profileCompletion.status || 'incomplete',
        firstLoginAt: updatedUser.profileCompletion.firstLoginAt,
        profileCompletionDeadline: updatedUser.profileCompletion.profileCompletionDeadline,
        completedAt: updatedUser.profileCompletion.completedAt,
        completedFields: updatedUser.profileCompletion.completedFields || {
          personalInfo: false,
          aadhaarUploaded: false,
          ocrVerified: false
        }
      } : {
        status: 'incomplete',
        completedFields: {
          personalInfo: false,
          aadhaarUploaded: false,
          ocrVerified: false
        }
      },
      employeeId: employeeData ? {
        _id: user.employeeId.toString(),
        id: user.employeeId.toString(),
        employeeCode: employeeData.employeeCode,
        firstName: employeeData.firstName,
        lastName: employeeData.lastName,
        fullName: `${employeeData.firstName} ${employeeData.lastName}`,
        email: employeeData.email,
        phone: employeeData.phone,
        designation: employeeData.designation,
        department: employeeData.department,
        profilePicture: employeeData.profilePicture,
      } : user.employeeId ? { _id: user.employeeId.toString(), id: user.employeeId.toString() } : null,
      ...(employeeData && {
        firstName: employeeData.firstName,
        lastName: employeeData.lastName,
        fullName: `${employeeData.firstName} ${employeeData.lastName}`,
        profilePicture: employeeData.profilePicture,
        designation: employeeData.designation,
        department: employeeData.department,
        employeeCode: employeeData.employeeCode,
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Password changed successfully',
      user: userData
    })

  } catch (error) {
    if (error.code === 'INVALID_RESET') return NextResponse.json({ success: false, message: error.message }, { status: 400 })
    // Enhanced error logging with context
    const errorContext = {
      timestamp: new Date().toISOString(),
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    }
    console.error('[Change Password] Error:', JSON.stringify(errorContext, null, 2))

    // Differentiate error types for better debugging
    let errorMessage = 'Failed to change password'
    let errorCode = 'CHANGE_PASSWORD_ERROR'

    if ([4, 14].includes(error.code) || error.message?.includes('ETIMEOUT')) {
      errorMessage = 'Database connection issue. Please try again.'
      errorCode = 'DB_CONNECTION_ERROR'
    } else if (error.name === 'ValidationError') {
      errorMessage = 'Invalid password format'
      errorCode = 'VALIDATION_ERROR'
    } else if (error.code === 'ALREADY_EXISTS') {
      errorMessage = 'A conflict occurred. Please try again.'
      errorCode = 'DB_CONFLICT_ERROR'
    }

    return NextResponse.json(
      { success: false, message: errorMessage, errorCode },
      { status: 500 }
    )
  }
}

// GET endpoint to check if password change is required
export async function GET(request) {
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
      const auth = await verifyTokenFromRequest(request)
      if (!auth.success) throw new Error('Invalid session')
      payload = auth.user
    } catch (error) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 401 }
      )
    }

    // SECURITY: Require tenant context from JWT
    if (!payload.databaseName) {
      return NextResponse.json(
        { success: false, message: 'Invalid session - please log in again' },
        { status: 401 }
      )
    }

    // Get tenant-specific User model
    const repository = await getNativeAuthRepository(payload.databaseName)
    const user = await repository.database.get('users', String(payload.userId))

    if (!user) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      forcePasswordChange: user.forcePasswordChange === true,
      isActive: user.isActive
    })

  } catch (error) {
    // Enhanced error logging with context
    const errorContext = {
      timestamp: new Date().toISOString(),
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    }
    console.error('[Check Password Change] Error:', JSON.stringify(errorContext, null, 2))

    // Differentiate error types
    let errorMessage = 'Failed to check password change status'
    let errorCode = 'CHECK_PASSWORD_STATUS_ERROR'

    if ([4, 14].includes(error.code) || error.message?.includes('ETIMEOUT')) {
      errorMessage = 'Database connection issue. Please try again.'
      errorCode = 'DB_CONNECTION_ERROR'
    }

    return NextResponse.json(
      { success: false, message: errorMessage, errorCode },
      { status: 500 }
    )
  }
}
