import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'

// Helper to validate MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}

// GET - Get single attendance record
export async function GET(request, { params }) {
  try {
    const { id } = await params

    // Validate ObjectId
    if (!isValidObjectId(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid attendance record ID' },
        { status: 400 }
      )
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Attendance'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Attendance } = models

    const attendance = await Attendance.findById(id)
      .populate('employee', 'firstName lastName employeeCode')

    if (!attendance) {
      return NextResponse.json(
        { success: false, message: 'Attendance record not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: attendance,
    })
  } catch (error) {
    console.error('Get attendance error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch attendance record' },
      { status: 500 }
    )
  }
}

// PUT - Update attendance record
export async function PUT(request, { params }) {
  try {
    const { id } = await params

    // Validate ObjectId
    if (!isValidObjectId(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid attendance record ID' },
        { status: 400 }
      )
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Attendance'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Attendance } = models

    const data = await request.json()

    const attendance = await Attendance.findByIdAndUpdate(
      id,
      data,
      { new: true, runValidators: true }
    ).populate('employee', 'firstName lastName employeeCode')

    if (!attendance) {
      return NextResponse.json(
        { success: false, message: 'Attendance record not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Attendance updated successfully',
      data: attendance,
    })
  } catch (error) {
    console.error('Update attendance error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update attendance' },
      { status: 500 }
    )
  }
}

// DELETE - Delete attendance record
export async function DELETE(request, { params }) {
  try {
    const { id } = await params

    // Validate ObjectId
    if (!isValidObjectId(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid attendance record ID' },
        { status: 400 }
      )
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Attendance'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Attendance } = models

    const attendance = await Attendance.findByIdAndDelete(id)

    if (!attendance) {
      return NextResponse.json(
        { success: false, message: 'Attendance record not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Attendance deleted successfully',
    })
  } catch (error) {
    console.error('Delete attendance error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete attendance' },
      { status: 500 }
    )
  }
}

