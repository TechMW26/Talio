import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { normalizeLeaveType } from '@/lib/leaveData'
// GET - Get single leave type
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['LeaveType'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { LeaveType } = models
    const { id } = await params

    const leaveType = await LeaveType.findById(id).lean()

    if (!leaveType) {
      return NextResponse.json(
        { success: false, message: 'Leave type not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: normalizeLeaveType(leaveType),
    })
  } catch (error) {
    console.error('Get leave type error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch leave type' },
      { status: 500 }
    )
  }
}

// PUT - Update leave type
export async function PUT(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['LeaveType'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { LeaveType } = models
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const { id } = await params
    const data = await request.json()
    const mirroredData = {
      ...data,
      ...(data.maxDaysPerYear !== undefined
        ? { daysPerYear: data.maxDaysPerYear }
        : {}),
      ...(data.maxCarryForwardDays !== undefined
        ? { maxCarryForward: data.maxCarryForwardDays }
        : {}),
      ...(data.minDaysNotice !== undefined
        ? { minNoticeDays: data.minDaysNotice }
        : {}),
    }

    const leaveType = await LeaveType.findByIdAndUpdate(
      id,
      mirroredData,
      { new: true, runValidators: true }
    )

    if (!leaveType) {
      return NextResponse.json(
        { success: false, message: 'Leave type not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Leave type updated successfully',
      data: normalizeLeaveType(leaveType),
    })
  } catch (error) {
    console.error('Update leave type error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update leave type' },
      { status: 500 }
    )
  }
}

// DELETE - Delete leave type
export async function DELETE(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['LeaveType'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { LeaveType } = models
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const { id } = await params
    const leaveType = await LeaveType.findByIdAndDelete(id)

    if (!leaveType) {
      return NextResponse.json(
        { success: false, message: 'Leave type not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Leave type deleted successfully',
    })
  } catch (error) {
    console.error('Delete leave type error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete leave type' },
      { status: 500 }
    )
  }
}

