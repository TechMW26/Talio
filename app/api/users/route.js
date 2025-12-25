import { NextResponse } from 'next/server'
import { verifyTokenFromRequest, getAuthAndModels } from '@/lib/auth'

export const dynamic = 'force-dynamic'


export async function GET(request) {
  try {
    // Verify authentication
    const authResult = await verifyTokenFromRequest(request)
    if (!authResult.success) {
      return NextResponse.json(
        { message: authResult.message },
        { status: 401 }
      )
    }

    // Only admin can view all users
    if (authResult.user.role !== 'admin') {
      return NextResponse.json(
        { message: 'Access denied. Admin only.' },
        { status: 403 }
      )
    }

    // TODO: MIGRATION - Replace verifyTokenFromRequest with getAuthAndModels
    // const { success, user, models, message } = await getAuthAndModels(request, ['User'])
    // if (!success) return NextResponse.json({ message }, { status: 401 })
    // const { User } = models
    // Fetch all users with passwords and populate employee data
    const users = await User.find({})
      .select('+password') // Include password field
      .populate('employeeId', 'firstName lastName employeeCode')
      .sort({ createdAt: -1 })

    return NextResponse.json({
      success: true,
      data: users,
    })

  } catch (error) {
    console.error('Error fetching users:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}
