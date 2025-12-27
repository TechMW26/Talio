import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
export const dynamic = 'force-dynamic'


// GET - Fetch current user's profile
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee, User } = models

    // Fetch user with populated employee data
    const userRecord = await User.findById(user._id || user.userId)
      .populate({
        path: 'employeeId',
        select: 'firstName lastName employeeCode email phone profilePicture designation designationLevel designationLevelName department departments reportingManager status dateOfJoining dateOfBirth gender address emergencyContact bloodGroup company',
        populate: [
          { path: 'designation', select: 'title level levelName' },
          { path: 'department', select: 'name code' },
          { path: 'departments', select: 'name code' },
          { path: 'reportingManager', select: 'firstName lastName employeeCode' },
          { path: 'company', select: 'name logo' }
        ]
      })

    if (!userRecord) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        user: {
          _id: userRecord._id,
          email: userRecord.email,
          role: userRecord.role
        },
        employee: userRecord.employeeId
      }
    })
  } catch (error) {
    console.error('Get profile error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

