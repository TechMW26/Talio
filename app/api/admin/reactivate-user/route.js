import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/reactivate-user
 * Reactivate a user account that was suspended for incomplete profile
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User } = models

    // Verify admin/HR role
    const adminId = user._id || user.userId
    if (!adminId) {
      return NextResponse.json({ success: false, message: 'User ID not found' }, { status: 400 })
    }
    const adminUser = await User.findById(adminId).select('role')
    if (!adminUser || !['admin', 'hr'].includes(adminUser.role)) {
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

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return NextResponse.json({
        success: false,
        message: 'Invalid user ID format'
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
      const daysToAdd = Number(additionalDays)
      if (Number.isNaN(daysToAdd) || daysToAdd < 0) {
        return NextResponse.json({
          success: false,
          message: 'additionalDays must be a positive number'
        }, { status: 400 })
      }
      const newDeadline = new Date()
      newDeadline.setDate(newDeadline.getDate() + daysToAdd)
      updateData['profileCompletion.profileCompletionDeadline'] = newDeadline
    }

    await User.findByIdAndUpdate(userId, { $set: updateData })

    // Log the action
    console.log(`[Admin] User ${userToReactivate.email} reactivated by ${adminUser.role} (ID: ${user._id || user.userId})`)

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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User } = models

    // Verify admin/HR role
    const adminId = user._id || user.userId
    if (!adminId) {
      return NextResponse.json({ success: false, message: 'User ID not found' }, { status: 400 })
    }
    const adminUser = await User.findById(adminId).select('role')
    if (!adminUser || !['admin', 'hr'].includes(adminUser.role)) {
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
        users: suspendedUsers.map(userRec => ({
          _id: userRec._id,
          email: userRec.email,
          name: userRec.employeeId 
            ? `${userRec.employeeId.firstName} ${userRec.employeeId.lastName}` 
            : 'N/A',
          employeeCode: userRec.employeeId?.employeeCode || 'N/A',
          suspendedAt: userRec.suspendedAt,
          profileStatus: userRec.profileCompletion?.status,
          firstLoginAt: userRec.profileCompletion?.firstLoginAt,
          originalDeadline: userRec.profileCompletion?.profileCompletionDeadline
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
