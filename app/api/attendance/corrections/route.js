import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import AttendanceCorrection from '@/models/AttendanceCorrection'
import Attendance from '@/models/Attendance'
import Employee from '@/models/Employee'
import Department from '@/models/Department'
import User from '@/models/User'
import { verifyToken } from '@/lib/auth'
import { calculateEffectiveWorkHours, determineAttendanceStatus } from '@/lib/attendanceShrinkage'
import CompanySettings from '@/models/CompanySettings'

export const dynamic = 'force-dynamic'

// Helper to check if user can approve corrections
async function canApproveCorrections(userId, targetEmployeeId) {
  const user = await User.findById(userId).populate('employeeId').lean()
  if (!user) return { canApprove: false, reason: 'User not found' }

  const role = user.role

  // God admin, admin, and HR can approve all corrections
  if (['admin', 'hr'].includes(role)) {
    return { canApprove: true, role }
  }

  // Department heads can approve for their department members
  if (user.employeeId) {
    const targetEmployee = await Employee.findById(targetEmployeeId).lean()
    if (!targetEmployee) return { canApprove: false, reason: 'Target employee not found' }

    // Check if user is head of target's department
    const department = await Department.findById(targetEmployee.department).lean()
    if (department) {
      const isHead = department.head?.toString() === user.employeeId._id.toString() ||
        (department.heads && department.heads.some(h => h.toString() === user.employeeId._id.toString()))

      if (isHead) {
        return { canApprove: true, role: 'department_head' }
      }
    }

    // Check if user is reporting manager of target
    if (targetEmployee.reportingManager?.toString() === user.employeeId._id.toString()) {
      return { canApprove: true, role: 'manager' }
    }
  }

  return { canApprove: false, reason: 'Insufficient permissions' }
}

// GET - List attendance corrections
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const employeeId = searchParams.get('employeeId')
    const type = searchParams.get('type') // 'my' for own requests, 'pending' for requests to approve

    const user = await User.findById(decoded.userId).populate('employeeId').lean()
    const userEmployeeId = user?.employeeId?._id?.toString()

    let query = {}

    if (type === 'my' && userEmployeeId) {
      // Get user's own correction requests
      query.employee = userEmployeeId
    } else if (type === 'pending') {
      // Get pending requests for approval (for admins/HRs/dept heads)
      const canApprove = await canApproveCorrections(decoded.userId, null)

      if (['admin', 'hr'].includes(user?.role)) {
        // Can see all pending
        query.status = 'pending'
      } else if (user?.employeeId) {
        // Department head - get pending for their department
        const departments = await Department.find({
          $or: [
            { head: user.employeeId._id },
            { heads: user.employeeId._id }
          ]
        }).lean()

        const deptIds = departments.map(d => d._id)
        const deptEmployees = await Employee.find({ department: { $in: deptIds } }).select('_id').lean()
        const empIds = deptEmployees.map(e => e._id)

        query.employee = { $in: empIds }
        query.status = 'pending'
      }
    } else if (employeeId) {
      query.employee = employeeId
    }

    if (status && status !== 'all') {
      query.status = status
    }

    const corrections = await AttendanceCorrection.find(query)
      .populate('employee', 'firstName lastName employeeCode profilePicture')
      .populate('attendance', 'date checkIn checkOut status workHours')
      .populate('reviewedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean()

    return NextResponse.json({
      success: true,
      data: corrections
    })
  } catch (error) {
    console.error('Get corrections error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch corrections' },
      { status: 500 }
    )
  }
}

// POST - Create attendance correction request
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()

    const data = await request.json()
    const {
      attendanceId,
      date,
      correctionType,
      requestedCheckIn,
      requestedCheckOut,
      requestedStatus,
      reason,
      attachments
    } = data

    const user = await User.findById(decoded.userId).populate('employeeId').lean()
    if (!user?.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const employeeId = user.employeeId._id

    // Find or validate attendance record
    let attendance
    if (attendanceId) {
      attendance = await Attendance.findById(attendanceId).lean()
      if (!attendance) {
        return NextResponse.json({ success: false, message: 'Attendance record not found' }, { status: 404 })
      }
    } else if (date) {
      // For missing entry corrections
      const dateStart = new Date(date)
      dateStart.setHours(0, 0, 0, 0)
      const dateEnd = new Date(date)
      dateEnd.setHours(23, 59, 59, 999)

      attendance = await Attendance.findOne({
        employee: employeeId,
        date: { $gte: dateStart, $lte: dateEnd }
      }).lean()

      // If no attendance exists for missing entry, create a placeholder
      if (!attendance && correctionType === 'missing-entry') {
        attendance = await Attendance.create({
          employee: employeeId,
          date: dateStart,
          status: 'absent',
          isManualEntry: true
        })
        attendance = attendance.toObject()
      }
    }

    if (!attendance) {
      return NextResponse.json({ success: false, message: 'Attendance record not found for this date' }, { status: 404 })
    }

    // Check for existing pending correction
    const existingCorrection = await AttendanceCorrection.findOne({
      attendance: attendance._id,
      status: 'pending'
    }).lean()

    if (existingCorrection) {
      return NextResponse.json({
        success: false,
        message: 'A pending correction request already exists for this date'
      }, { status: 400 })
    }

    // Create correction request
    const correction = await AttendanceCorrection.create({
      employee: employeeId,
      attendance: attendance._id,
      date: attendance.date,
      currentCheckIn: attendance.checkIn,
      currentCheckOut: attendance.checkOut,
      currentStatus: attendance.status,
      currentWorkHours: attendance.workHours,
      correctionType,
      requestedCheckIn: requestedCheckIn ? new Date(requestedCheckIn) : undefined,
      requestedCheckOut: requestedCheckOut ? new Date(requestedCheckOut) : undefined,
      requestedStatus,
      reason,
      attachments: attachments || [],
      status: 'pending'
    })

    return NextResponse.json({
      success: true,
      message: 'Correction request submitted successfully',
      data: correction
    })
  } catch (error) {
    console.error('Create correction error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create correction request' },
      { status: 500 }
    )
  }
}

// PATCH - Approve/Reject correction request
export async function PATCH(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()

    const data = await request.json()
    const { correctionId, action, reviewerComments } = data

    if (!correctionId || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ success: false, message: 'Invalid request' }, { status: 400 })
    }

    const correction = await AttendanceCorrection.findById(correctionId)
    if (!correction) {
      return NextResponse.json({ success: false, message: 'Correction request not found' }, { status: 404 })
    }

    if (correction.status !== 'pending') {
      return NextResponse.json({ success: false, message: 'This request has already been processed' }, { status: 400 })
    }

    // Check permissions
    const { canApprove, reason } = await canApproveCorrections(decoded.userId, correction.employee)
    if (!canApprove) {
      return NextResponse.json({ success: false, message: reason || 'Unauthorized' }, { status: 403 })
    }

    const user = await User.findById(decoded.userId).populate('employeeId').lean()
    const reviewerEmployeeId = user?.employeeId?._id

    if (action === 'approve') {
      // Apply the correction to the attendance record
      const attendance = await Attendance.findById(correction.attendance)
      if (!attendance) {
        return NextResponse.json({ success: false, message: 'Attendance record not found' }, { status: 404 })
      }

      // Apply requested changes
      if (correction.requestedCheckIn) {
        attendance.checkIn = correction.requestedCheckIn
      }
      if (correction.requestedCheckOut) {
        attendance.checkOut = correction.requestedCheckOut
      }

      // Recalculate work hours if both check-in and check-out exist
      if (attendance.checkIn && attendance.checkOut) {
        const settings = await CompanySettings.findOne().lean()
        const breakTimings = settings?.breakTimings || []

        const workHoursCalc = calculateEffectiveWorkHours(
          attendance.checkIn,
          attendance.checkOut,
          breakTimings
        )

        attendance.workHours = workHoursCalc.effectiveWorkHours
        attendance.totalLoggedHours = workHoursCalc.totalLoggedHours
        attendance.breakMinutes = workHoursCalc.breakMinutes
        attendance.shrinkagePercentage = workHoursCalc.shrinkagePercentage

        // Determine status
        const statusResult = determineAttendanceStatus(workHoursCalc.effectiveWorkHours, {
          fullDayHours: settings?.fullDayHours || 8,
          halfDayHours: settings?.halfDayHours || 4
        })

        attendance.status = correction.requestedStatus || statusResult.status
        attendance.statusReason = `Corrected: ${statusResult.reason}`
      } else if (correction.requestedStatus) {
        attendance.status = correction.requestedStatus
      }

      attendance.isManualEntry = true
      attendance.remarks = `Corrected on ${new Date().toLocaleDateString()} - ${correction.reason}`

      await attendance.save()

      // Update correction record
      correction.status = 'approved'
      correction.reviewedBy = reviewerEmployeeId
      correction.reviewedAt = new Date()
      correction.reviewerComments = reviewerComments
      correction.appliedCheckIn = attendance.checkIn
      correction.appliedCheckOut = attendance.checkOut
      correction.appliedStatus = attendance.status
      correction.appliedWorkHours = attendance.workHours

      await correction.save()

      return NextResponse.json({
        success: true,
        message: 'Correction approved and applied successfully',
        data: correction
      })
    } else {
      // Reject
      correction.status = 'rejected'
      correction.reviewedBy = reviewerEmployeeId
      correction.reviewedAt = new Date()
      correction.reviewerComments = reviewerComments

      await correction.save()

      return NextResponse.json({
        success: true,
        message: 'Correction request rejected',
        data: correction
      })
    }
  } catch (error) {
    console.error('Process correction error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to process correction' },
      { status: 500 }
    )
  }
}
