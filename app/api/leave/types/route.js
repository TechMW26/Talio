import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { normalizeLeaveType, normalizeLeaveTypes } from '@/lib/leaveData'
// GET - List all leave types
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['LeaveType'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { LeaveType } = models

    const leaveTypes = await LeaveType.find({ isActive: true })
      .sort({ name: 1 })
      .lean()

    return NextResponse.json({
      success: true,
      data: normalizeLeaveTypes(leaveTypes),
    })
  } catch (error) {
    console.error('Get leave types error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch leave types' },
      { status: 500 }
    )
  }
}

// POST - Create leave type
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['LeaveType'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { LeaveType } = models

    // Only admins and HR can create leave types
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized - only admin and HR can create leave types' },
        { status: 403 }
      )
    }

    const data = await request.json()

    const leaveType = await LeaveType.create(data)

    return NextResponse.json({
      success: true,
      message: 'Leave type created successfully',
      data: normalizeLeaveType(leaveType),
    }, { status: 201 })
  } catch (error) {
    console.error('Create leave type error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create leave type' },
      { status: 500 }
    )
  }
}

