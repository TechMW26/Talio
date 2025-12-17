import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import User from '@/models/User'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/reactivate-user
 * Reactivate a user account that was suspended for incomplete profile
 */
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()

    // Verify admin/HR role
    const adminUser = await User.findById(decoded.userId).select('role')
    if (!adminUser || !['admin', 'hr', 'god_admin'].includes(adminUser.role)) {
      return NextResponse.json({
        success: false,
        message: 'Admin or HR access required'
      }, { status: 403 })
    }

    const body = await request.json()
    const { userId, extendDeadline = true, additionalDays = 7 } = body

    if (!userId) {
      return NextResponse.json({
        success: false,
        message: 'User ID is required'
      }, { status: 400 })
    }

    // Find the user to reactivate
    const userToReactivate = await User.findById(userId)
    if (!userToReactivate) {
      return NextResponse.json({
        success: false,
        message: 'User not found'
      }, { status: 404 })
    }

    // Check if user was suspended for profile_incomplete
    if (userToReactivate.suspensionReason !== 'profile_incomplete') {
      return NextResponse.json({
        success: false,
        message: 'User was not suspended for incomplete profile'
      }, { status: 400 })
    }

    // Prepare update data
    const updateData = {
      isActive: true,
      suspensionReason: null,
      suspendedAt: null
    }

    // Optionally extend the profile completion deadline
    if (extendDeadline) {
      const newDeadline = new Date()
      newDeadline.setDate(newDeadline.getDate() + additionalDays)
      updateData['profileCompletion.profileCompletionDeadline'] = newDeadline
    }

    await User.findByIdAndUpdate(userId, { $set: updateData })

    // Log the action
    console.log(`[Admin] User ${userToReactivate.email} reactivated by ${adminUser.role} (ID: ${decoded.userId})`)

    return NextResponse.json({
      success: true,
      message: 'User reactivated successfully',
      data: {
        userId: userToReactivate._id,
        email: userToReactivate.email,
        newDeadline: extendDeadline ? updateData['profileCompletion.profileCompletionDeadline'] : null
      }
    })

  } catch (error) {
    console.error('[Admin Reactivate User] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to reactivate user'
    }, { status: 500 })
  }
}

/**
 * GET /api/admin/reactivate-user
 * Get list of users suspended for incomplete profile
 */
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()

    // Verify admin/HR role
    const adminUser = await User.findById(decoded.userId).select('role')
    if (!adminUser || !['admin', 'hr', 'god_admin'].includes(adminUser.role)) {
      return NextResponse.json({
        success: false,
        message: 'Admin or HR access required'
      }, { status: 403 })
    }

    // Find all suspended users with incomplete profile
    const suspendedUsers = await User.find({
      isActive: false,
      suspensionReason: 'profile_incomplete'
    })
      .select('email suspendedAt profileCompletion.status profileCompletion.firstLoginAt profileCompletion.profileCompletionDeadline')
      .populate({
        path: 'employeeId',
        select: 'firstName lastName employeeCode'
      })
      .lean()

    return NextResponse.json({
      success: true,
      data: {
        count: suspendedUsers.length,
        users: suspendedUsers.map(user => ({
          _id: user._id,
          email: user.email,
          name: user.employeeId 
            ? `${user.employeeId.firstName} ${user.employeeId.lastName}` 
            : 'N/A',
          employeeCode: user.employeeId?.employeeCode || 'N/A',
          suspendedAt: user.suspendedAt,
          profileStatus: user.profileCompletion?.status,
          firstLoginAt: user.profileCompletion?.firstLoginAt,
          originalDeadline: user.profileCompletion?.profileCompletionDeadline
        }))
      }
    })

  } catch (error) {
    console.error('[Admin Get Suspended Users] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to get suspended users'
    }, { status: 500 })
  }
}
