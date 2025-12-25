import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { calculateEffectiveWorkHours, determineAttendanceStatus } from '@/lib/attendanceShrinkage'
import queryCache from '@/lib/queryCache'

export const dynamic = 'force-dynamic'

/**
 * ATTENDANCE CORRECTION FLOW - STREAMLINED
 * =========================================
 * 
 * DATA SOURCES:
 * - Attendance Collection: Single source of truth for attendance data
 * - AttendanceCorrection Collection: Stores correction requests and audit trail
 * 
 * FLOW:
 * 1. Employee submits correction request → Creates AttendanceCorrection record
 * 2. Admin/Head approves → Updates Attendance record (source of truth)
 * 3. UI reads attendance data from Attendance collection only
 * 4. AttendanceCorrection stores audit trail (what was requested, what was applied)
 * 
 * STATUS CALCULATION:
 * - When checkIn AND checkOut exist: Status is ALWAYS calculated from work hours
 * - Formula: workHours >= 7.2h (90% of 8h) = present
 *            workHours >= 4h (50% of 8h) = half-day
 *            workHours < 4h = absent
 */

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

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['AttendanceCorrection', 'Attendance', 'Employee', 'Department', 'User', 'CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { AttendanceCorrection, Attendance, Employee, Department, User, CompanySettings } = models

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

    const data = await request.json()
    const { correctionId, action, reviewerComments } = data

    if (!correctionId || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ success: false, message: 'Invalid request' }, { status: 400 })
    }

    // =====================================================
    // STEP 1: Load correction request from AttendanceCorrection
    // =====================================================
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
      // =====================================================
      // STEP 2: Load the Attendance record (SOURCE OF TRUTH)
      // =====================================================
      const attendance = await Attendance.findById(correction.attendance)
      if (!attendance) {
        return NextResponse.json({ success: false, message: 'Attendance record not found' }, { status: 404 })
      }

      // =====================================================
      // STEP 3: Apply requested check-in/check-out times
      // =====================================================
      if (correction.requestedCheckIn) {
        attendance.checkIn = correction.requestedCheckIn
      }
      if (correction.requestedCheckOut) {
        attendance.checkOut = correction.requestedCheckOut
      }

      // =====================================================
      // STEP 4: Calculate work hours and status
      // This is the CRITICAL part - status is ALWAYS calculated
      // from work hours when both checkIn and checkOut exist
      // =====================================================
      let calculatedStatus = 'absent'
      let calculatedWorkHours = 0
      let statusReason = ''

      if (attendance.checkIn && attendance.checkOut) {
        // Get company settings for break timings and thresholds
        const settings = await CompanySettings.findOne().lean()
        const breakTimings = settings?.breakTimings || []
        const fullDayHours = settings?.fullDayHours || 8
        const halfDayHours = settings?.halfDayHours || 4

        // Calculate effective work hours (accounting for breaks)
        const workHoursCalc = calculateEffectiveWorkHours(
          attendance.checkIn,
          attendance.checkOut,
          breakTimings
        )

        calculatedWorkHours = workHoursCalc.effectiveWorkHours

        // Update attendance with calculated values
        attendance.workHours = calculatedWorkHours
        attendance.totalLoggedHours = workHoursCalc.totalLoggedHours
        attendance.breakMinutes = workHoursCalc.breakMinutes
        attendance.shrinkagePercentage = workHoursCalc.shrinkagePercentage

        // =====================================================
        // STEP 5: Determine status based on work hours
        // This OVERRIDES any requestedStatus from the correction
        // =====================================================
        const statusResult = determineAttendanceStatus(calculatedWorkHours, {
          fullDayHours,
          halfDayHours
        })

        calculatedStatus = statusResult.status
        statusReason = statusResult.reason

        console.log(`\n📝 CORRECTION APPROVAL - Employee: ${correction.employee}`)
        console.log(`   CheckIn: ${attendance.checkIn}`)
        console.log(`   CheckOut: ${attendance.checkOut}`)
        console.log(`   Work Hours: ${calculatedWorkHours.toFixed(2)}h`)
        console.log(`   Full Day Threshold: ${fullDayHours * 0.9}h (90% of ${fullDayHours}h)`)
        console.log(`   Half Day Threshold: ${fullDayHours * 0.5}h (50% of ${fullDayHours}h)`)
        console.log(`   Calculated Status: ${calculatedStatus}`)
        console.log(`   Reason: ${statusReason}\n`)

      } else if (correction.requestedStatus && !attendance.checkIn && !attendance.checkOut) {
        // Only use requestedStatus when there's NO check-in/check-out at all
        calculatedStatus = correction.requestedStatus
        statusReason = 'Manual status set (no check-in/out times)'
      }

      // =====================================================
      // STEP 6: Update Attendance record (SOURCE OF TRUTH)
      // This is the CRITICAL update - all fields must be set here
      // =====================================================

      // Core status fields
      attendance.status = calculatedStatus
      attendance.statusReason = `Corrected: ${statusReason}`

      // Audit/tracking fields
      attendance.isManualEntry = true
      attendance.source = 'correction'
      attendance.remarks = `Corrected on ${new Date().toLocaleDateString('en-IN')} - ${correction.reason}`

      // Clear system-generated flags (important for auto-absent records)
      attendance.createdBySystem = false

      // Set correction audit fields
      attendance.lastModifiedBy = decoded.userId
      attendance.approvedBy = reviewerEmployeeId

      // Save the attendance record
      await attendance.save()

      // =====================================================
      // STEP 7: Reload to confirm saved values
      // =====================================================
      const savedAttendance = await Attendance.findById(attendance._id).lean()

      // =====================================================
      // STEP 8: Update correction record with ACTUAL saved values
      // This is for audit trail only - UI reads from Attendance
      // =====================================================
      correction.status = 'approved'
      correction.reviewedBy = reviewerEmployeeId
      correction.reviewedAt = new Date()
      correction.reviewerComments = reviewerComments || ''

      // Store what was ACTUALLY applied (from the saved Attendance record)
      correction.appliedCheckIn = savedAttendance.checkIn
      correction.appliedCheckOut = savedAttendance.checkOut
      correction.appliedStatus = savedAttendance.status
      correction.appliedWorkHours = savedAttendance.workHours

      await correction.save()

      // =====================================================
      // STEP 9: Invalidate attendance cache for this employee
      // This ensures the next API call fetches fresh data
      // =====================================================
      const attendanceDate = new Date(savedAttendance.date)
      const month = attendanceDate.getMonth() + 1
      const year = attendanceDate.getFullYear()

      // Clear all cache entries for this employee's attendance
      queryCache.clearPattern(`attendance.*${correction.employee}`)
      console.log(`🗑️ Cache invalidated for employee: ${correction.employee}`)

      // =====================================================
      // STEP 10: Emit real-time update via Socket.IO
      // This notifies the employee's browser to refresh
      // =====================================================
      const employeeUser = await User.findOne({ employeeId: correction.employee }).select('_id').lean()
      if (global.io && employeeUser) {
        global.io.to(`user:${employeeUser._id}`).emit('attendance-updated', {
          type: 'correction-approved',
          attendanceId: savedAttendance._id,
          employeeId: correction.employee.toString(),
          date: savedAttendance.date,
          status: savedAttendance.status,
          workHours: savedAttendance.workHours,
          message: `Your attendance correction for ${new Date(savedAttendance.date).toLocaleDateString('en-IN')} has been approved. Status: ${savedAttendance.status}`
        })
        console.log(`📡 Socket event sent to user: ${employeeUser._id}`)
      }

      console.log(`✅ CORRECTION COMPLETE:`)
      console.log(`   Attendance ID: ${savedAttendance._id}`)
      console.log(`   Employee ID: ${correction.employee}`)
      console.log(`   Final Status: ${savedAttendance.status}`)
      console.log(`   Final Work Hours: ${savedAttendance.workHours}h\n`)

      return NextResponse.json({
        success: true,
        message: `Correction approved - Status: ${savedAttendance.status} (${savedAttendance.workHours?.toFixed(2) || 0}h worked)`,
        data: {
          correction,
          attendance: savedAttendance,  // Return the actual attendance data
          employeeId: correction.employee.toString() // Return employee ID for frontend refresh
        }
      })
    } else {
      // =====================================================
      // REJECTION - Only update correction record
      // =====================================================
      correction.status = 'rejected'
      correction.reviewedBy = reviewerEmployeeId
      correction.reviewedAt = new Date()
      correction.reviewerComments = reviewerComments || ''

      await correction.save()

      // Emit rejection event to employee
      const employeeUser = await User.findOne({ employeeId: correction.employee }).select('_id').lean()
      if (global.io && employeeUser) {
        global.io.to(`user:${employeeUser._id}`).emit('attendance-updated', {
          type: 'correction-rejected',
          correctionId: correction._id,
          employeeId: correction.employee.toString(),
          date: correction.date,
          message: `Your attendance correction for ${new Date(correction.date).toLocaleDateString('en-IN')} has been rejected.`
        })
      }

      return NextResponse.json({
        success: true,
        message: 'Correction request rejected',
        data: {
          correction,
          employeeId: correction.employee.toString()
        }
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
