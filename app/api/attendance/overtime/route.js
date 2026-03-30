import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { calculateEffectiveWorkHours, determineAttendanceStatus } from '@/lib/attendanceShrinkage'
import { sendPushToUser } from '@/lib/pushNotification'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

// Helper to validate MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}

/**
 * GET /api/attendance/overtime
 * Get pending overtime requests for the current user
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['OvertimeRequest', 'Attendance', 'Employee', 'CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { OvertimeRequest, Attendance, Employee, CompanySettings } = models

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'pending'

    // Get employee ID from auth user
    const employeeId = user.employeeId?._id || user.employeeId
    const employee = await Employee.findById(employeeId).lean()
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const query = { employee: employee._id }
    if (status !== 'all') {
      query.status = status
    }

    const overtimeRequests = await OvertimeRequest.find(query)
      .populate('attendance')
      .sort({ promptSentAt: -1 })
      .limit(10)
      .lean()

    return NextResponse.json({
      success: true,
      data: overtimeRequests
    })
  } catch (error) {
    console.error('Get overtime requests error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

/**
 * POST /api/attendance/overtime
 * Respond to an overtime request
 * 
 * Body:
 * - requestId: OvertimeRequest ID
 * - isWorkingOvertime: boolean
 * - estimatedEndTime: optional, for planning (not used for calculation)
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['OvertimeRequest', 'Attendance', 'Employee', 'CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { OvertimeRequest, Attendance, Employee, CompanySettings } = models

    const body = await request.json()
    const { requestId, isWorkingOvertime, estimatedEndTime } = body

    if (!requestId) {
      return NextResponse.json({ success: false, message: 'Request ID is required' }, { status: 400 })
    }

    if (!isValidObjectId(requestId)) {
      return NextResponse.json(
        { success: false, message: 'Invalid request ID' },
        { status: 400 }
      )
    }

    // Get employee ID from auth user
    const employeeId = user.employeeId?._id || user.employeeId
    const employee = await Employee.findById(employeeId).lean()
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const overtimeRequest = await OvertimeRequest.findOne({
      _id: requestId,
      employee: employee._id,
      status: 'pending'
    })

    if (!overtimeRequest) {
      return NextResponse.json({ success: false, message: 'Overtime request not found or already processed' }, { status: 404 })
    }

    const now = new Date()
    overtimeRequest.respondedAt = now
    overtimeRequest.isWorkingOvertime = isWorkingOvertime

    if (isWorkingOvertime) {
      // Employee confirms they're working overtime
      overtimeRequest.status = 'overtime-confirmed'

      // We'll calculate overtime hours when they actually check out
      // For now, just mark as confirmed

      await overtimeRequest.save()

      return NextResponse.json({
        success: true,
        message: 'Overtime confirmed. Remember to check out when you finish!',
        data: overtimeRequest
      })
    } else {
      // Employee says they're NOT working overtime - clock them out now
      overtimeRequest.status = 'manual-checkout'

      const attendance = await Attendance.findById(overtimeRequest.attendance)
      if (attendance && !attendance.checkOut) {
        // Get company settings for shrinkage calculation
        const settings = await CompanySettings.findOne().lean()

        attendance.checkOut = now

        // Calculate work hours using shrinkage method
        if (attendance.checkIn && settings?.breakTimings) {
          const workCalc = calculateEffectiveWorkHours(
            attendance.checkIn,
            now,
            settings.breakTimings
          )

          attendance.workHours = workCalc.effectiveWorkHours
          attendance.totalLoggedHours = workCalc.totalLoggedHours
          attendance.breakMinutes = workCalc.breakMinutes
          attendance.shrinkagePercentage = workCalc.shrinkagePercentage

          // Determine final status
          const statusResult = determineAttendanceStatus(workCalc.effectiveWorkHours, {
            fullDayHours: settings.fullDayHours || 8,
            halfDayHours: settings.halfDayHours || 4
          })

          attendance.status = statusResult.status
          attendance.statusReason = statusResult.reason
        } else {
          // Fallback calculation
          const hoursWorked = (now - new Date(attendance.checkIn)) / (1000 * 60 * 60)
          attendance.workHours = parseFloat(hoursWorked.toFixed(2))
          attendance.status = hoursWorked >= 4 ? (hoursWorked >= 7 ? 'present' : 'half-day') : 'absent'
        }

        await attendance.save()
      }

      await overtimeRequest.save()

      return NextResponse.json({
        success: true,
        message: 'You have been clocked out successfully.',
        data: {
          overtimeRequest,
          checkOutTime: now
        }
      })
    }
  } catch (error) {
    console.error('Overtime response error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

/**
 * PATCH /api/attendance/overtime
 * Update overtime when employee manually checks out after confirming overtime
 * This is called automatically when clock-out happens after overtime was confirmed
 */
export async function PATCH(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['OvertimeRequest', 'Attendance'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { OvertimeRequest, Attendance } = models

    const body = await request.json()
    const { attendanceId, checkOutTime } = body

    if (!attendanceId) {
      return NextResponse.json({ success: false, message: 'Attendance ID is required' }, { status: 400 })
    }

    if (!isValidObjectId(attendanceId)) {
      return NextResponse.json(
        { success: false, message: 'Invalid attendance ID' },
        { status: 400 }
      )
    }

    // Find any overtime request for this attendance
    const overtimeRequest = await OvertimeRequest.findOne({
      attendance: attendanceId,
      status: 'overtime-confirmed'
    })

    if (!overtimeRequest) {
      return NextResponse.json({ success: true, message: 'No overtime request found' })
    }

    const checkOut = checkOutTime ? new Date(checkOutTime) : new Date()

    // Calculate overtime hours (time after scheduled checkout)
    const scheduledCheckout = new Date(overtimeRequest.scheduledCheckOut)
    const overtimeMs = checkOut - scheduledCheckout
    const overtimeHours = overtimeMs > 0 ? overtimeMs / (1000 * 60 * 60) : 0

    overtimeRequest.overtimeHours = parseFloat(overtimeHours.toFixed(2))
    overtimeRequest.status = 'manual-checkout'
    await overtimeRequest.save()

    // Update attendance with overtime
    await Attendance.findByIdAndUpdate(attendanceId, {
      overtime: parseFloat(overtimeHours.toFixed(2))
    })

    return NextResponse.json({
      success: true,
      message: `Overtime of ${overtimeHours.toFixed(2)} hours recorded`,
      data: {
        overtimeHours: parseFloat(overtimeHours.toFixed(2)),
        overtimeRequest
      }
    })
  } catch (error) {
    console.error('Update overtime error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
