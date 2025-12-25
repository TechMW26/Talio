import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
export const dynamic = 'force-dynamic'


// GET - Fetch current user's profile
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

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Employee, User } = models

    // Fetch user with populated employee data
    const user = await User.findById(decoded.userId)
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

    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        user: {
          _id: user._id,
          email: user.email,
          role: user.role
        },
        employee: user.employeeId
      }
    })
  } catch (error) {
    console.error('Get profile error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

