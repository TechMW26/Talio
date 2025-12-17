import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import connectDB from '@/lib/mongodb'
import User from '@/models/User'
import Employee from '@/models/Employee'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

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
      const verified = await jwtVerify(token, JWT_SECRET)
      payload = verified.payload
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

    await connectDB()

    // Get request body
    const { currentPassword, newPassword } = await request.json()

    // Validate input
    if (!currentPassword || !newPassword) {
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
    const user = await User.findById(payload.userId).select('+password')

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

    // Verify current password
    let isPasswordMatch = false
    try {
      isPasswordMatch = await user.comparePassword(currentPassword)
    } catch (error) {
      // Fallback for legacy users with plain text passwords
      if (user.password === currentPassword) {
        isPasswordMatch = true
      }
    }

    if (!isPasswordMatch) {
      return NextResponse.json(
        { success: false, message: 'Current password is incorrect' },
        { status: 400 }
      )
    }

    // Update password and set forcePasswordChange to false
    user.password = newPassword // Will be hashed by pre-save hook
    user.forcePasswordChange = false
    await user.save()

    // Refresh user data to get profileCompletion
    const updatedUser = await User.findById(user._id).select('profileCompletion')

    // Fetch employee data for response
    let employeeData = null
    if (user.employeeId) {
      try {
        employeeData = await Employee.findById(user.employeeId)
          .populate('designation')
          .populate('department')
          .lean()
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
    console.error('[Change Password] Error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to change password' },
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
      const verified = await jwtVerify(token, JWT_SECRET)
      payload = verified.payload
    } catch (error) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 401 }
      )
    }

    await connectDB()

    const user = await User.findById(payload.userId).select('forcePasswordChange isActive')

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
    console.error('[Check Password Change] Error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to check password change status' },
      { status: 500 }
    )
  }
}
