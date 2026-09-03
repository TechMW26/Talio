import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { calculateEffectiveWorkHours, determineAttendanceStatus } from '@/lib/attendanceShrinkage'
import { getTimezone, parseDateTimeInTimezone } from '@/lib/timezone'
import queryCache from '@/lib/queryCache'
import mongoose from 'mongoose'
import { emitEvent, EVENTS } from '@/lib/eventBus'
import { isDirectReport } from '@/lib/teamScope'

export const dynamic = 'force-dynamic'

// Helper to validate MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}

const isValidDateString = (value) => {
  if (!value) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime())
}

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
 * - Formula: workHours >= 6.5h (81.25% of 8h) = present (full day)
 *            workHours >= 5h (62.5% of 8h) = present (early checkout, with shrinkage)
 *            workHours < 5h = half-day
 */

// Helper to check if user can approve corrections (tenant-aware version)
async function canApproveCorrections(userId, targetEmployeeId, models) {
  const { User, Employee, Department, Team } = models

  const user = await User.findById(userId).populate({
    path: 'employeeId',
    options: { strictPopulate: false }
  }).lean()
  if (!user) return { canApprove: false, reason: 'User not found' }

  const role = user.role

  // God admin and admin can approve all corrections
  if (role === 'admin') {
    return { canApprove: true, role }
  }

  // HR users can ONLY approve if they're a department head (limited to their department)
  if (role === 'hr') {
    if (user.isDepartmentHead && user.headOfDepartments?.length > 0 && targetEmployeeId) {
      // Check if target employee is in HR's department
      const targetEmployee = await Employee.findById(targetEmployeeId).lean()
      if (targetEmployee && user.headOfDepartments.some(d => d.toString() === targetEmployee.department?.toString())) {
        return { canApprove: true, role: 'hr_department_head' }
      }
    }
    return { canApprove: false, reason: 'HR users can only approve within their department if they are the department head' }
  }

  // Department heads can approve for their department members
  if (user.employeeId && targetEmployeeId) {
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

    // Check if user is reporting manager / assignedManager / assignedTeamLead / reportsTo of target
    if (isDirectReport(targetEmployee, user.employeeId._id)) {
      return { canApprove: true, role: 'manager' }
    }

    // Check if user is a team leader of a team containing the target employee
    if (user.teamLeaderOf?.length > 0 && Team) {
      const ledTeams = await Team.find({ _id: { $in: user.teamLeaderOf }, isActive: true }).select('members teamLeaders').lean()
      const teamMemberIds = new Set()
      for (const team of ledTeams) {
        for (const m of (team.members || [])) teamMemberIds.add(m.toString())
        for (const l of (team.teamLeaders || [])) teamMemberIds.add(l.toString())
      }
      if (teamMemberIds.has(targetEmployee._id.toString())) {
        return { canApprove: true, role: 'team_leader' }
      }
    }
  }

  return { canApprove: false, reason: 'Insufficient permissions' }
}

// GET - List attendance corrections
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['AttendanceCorrection', 'Attendance', 'Employee', 'Department', 'User', 'CompanySettings', 'Team'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { AttendanceCorrection, Attendance, Employee, Department, User, CompanySettings, Team } = models

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const employeeId = searchParams.get('employeeId')
    const type = searchParams.get('type') // 'my' for own requests, 'pending' for requests to approve
    const departmentFilter = searchParams.get('department') // Department filter for admin/HR
    const teamFilter = searchParams.get('team') // Team filter

    if (employeeId && !isValidObjectId(employeeId)) {
      return NextResponse.json(
        { success: false, message: 'Invalid employee ID' },
        { status: 400 }
      )
    }

    if (departmentFilter && departmentFilter !== 'all' && !isValidObjectId(departmentFilter)) {
      return NextResponse.json(
        { success: false, message: 'Invalid department ID' },
        { status: 400 }
      )
    }

    const userEmployeeId = user?.employeeId?._id?.toString() || user?.employeeId?.toString()

    let query = {}

    if (type === 'my' && userEmployeeId) {
      // Get user's own correction requests
      query.employee = userEmployeeId
    } else if (type === 'pending' || type === 'all') {
      // Get requests for approval (for admins/HRs/dept heads)
      const canApprove = await canApproveCorrections(user._id, null, models)

      // Get user record to check department head status
      const userRecord = await User.findById(user._id || user.userId)
        .select('employeeId isDepartmentHead headOfDepartments')
        .lean()

      if (user?.role === 'admin') {
        // Admin can see all corrections
        if (type === 'pending') {
          query.status = 'pending'
        }

        // Apply department filter if specified
        if (departmentFilter && departmentFilter !== 'all') {
          const deptEmployees = await Employee.find({ department: departmentFilter }).select('_id').lean()
          const empIds = deptEmployees.map(e => e._id)
          query.employee = { $in: empIds }
        }
      } else if (user?.role === 'hr') {
        // HR users should ONLY see corrections if they're a department head
        // Regular HR employees should NOT see pending corrections - their dept head handles them
        if (userRecord?.isDepartmentHead && userRecord?.headOfDepartments?.length > 0) {
          // HR who is dept head - only see their department's corrections
          const deptEmployees = await Employee.find({
            department: { $in: userRecord.headOfDepartments },
            _id: { $ne: userRecord.employeeId }
          }).select('_id').lean()
          const empIds = deptEmployees.map(e => e._id)
          query.employee = { $in: empIds }
          if (type === 'pending') {
            query.status = 'pending'
          }
        } else {
          // Regular HR (not dept head) - only show their own corrections
          query.employee = userEmployeeId
        }
      } else if (user?.employeeId) {
        // Department head / team leader - get corrections for their department/team
        const userEmpId = user.employeeId._id || user.employeeId
        const departments = await Department.find({
          $or: [
            { head: userEmpId },
            { heads: userEmpId }
          ]
        }).lean()

        const deptIds = departments.map(d => d._id)

        if (deptIds.length > 0) {
          // Department head: see department members' corrections
          const deptEmployees = await Employee.find({ department: { $in: deptIds } }).select('_id').lean()
          const empIds = deptEmployees.map(e => e._id)
          query.employee = { $in: empIds }
        } else {
          // Check if user is a team leader
          const tlUser = await User.findById(user._id || user.userId).select('teamLeaderOf').lean()
          if (tlUser?.teamLeaderOf?.length > 0 && Team) {
            const ledTeams = await Team.find({ _id: { $in: tlUser.teamLeaderOf }, isActive: true }).select('members teamLeaders').lean()
            const teamMemberIds = []
            for (const team of ledTeams) {
              for (const m of (team.members || [])) teamMemberIds.push(m)
              for (const l of (team.teamLeaders || [])) teamMemberIds.push(l)
            }
            query.employee = { $in: teamMemberIds }
          } else {
            // Fallback: only own corrections
            query.employee = userEmployeeId
          }
        }

        if (type === 'pending') {
          query.status = 'pending'
        }
      }
    } else if (employeeId) {
      query.employee = employeeId
    }

    // Apply team filter if specified
    if (teamFilter && teamFilter !== 'all' && Team) {
      const team = await Team.findById(teamFilter).select('members teamLeaders').lean()
      if (team) {
        const teamMemberIds = new Set([
          ...team.members.map(id => id.toString()),
          ...team.teamLeaders.map(id => id.toString())
        ])
        if (query.employee?.$in) {
          query.employee = { $in: query.employee.$in.filter(id => teamMemberIds.has(id.toString())) }
        } else if (!query.employee || typeof query.employee === 'string') {
          query.employee = { $in: [...teamMemberIds].map(id => new mongoose.Types.ObjectId(id)) }
        }
      }
    }

    if (status && status !== 'all') {
      query.status = status
    }

    const corrections = await AttendanceCorrection.find(query)
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeCode profilePicture department',
        populate: { path: 'department', select: 'name' },
        options: { strictPopulate: false }
      })
      .populate({
        path: 'attendance',
        select: 'date checkIn checkOut status workHours',
        options: { strictPopulate: false }
      })
      .populate({
        path: 'reviewedBy',
        select: 'firstName lastName',
        options: { strictPopulate: false }
      })
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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Attendance', 'AttendanceCorrection', 'CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Attendance, AttendanceCorrection, CompanySettings } = models

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

    if (attendanceId && !isValidObjectId(attendanceId)) {
      return NextResponse.json(
        { success: false, message: 'Invalid attendance ID' },
        { status: 400 }
      )
    }

    if (date && !isValidDateString(date)) {
      return NextResponse.json(
        { success: false, message: 'Invalid date format' },
        { status: 400 }
      )
    }

    const settings = await CompanySettings.findOne().lean()
    const companyTimezone = getTimezone(settings?.timezone)

    const parsedRequestedCheckIn = requestedCheckIn
      ? parseDateTimeInTimezone(requestedCheckIn, companyTimezone)
      : null
    const parsedRequestedCheckOut = requestedCheckOut
      ? parseDateTimeInTimezone(requestedCheckOut, companyTimezone)
      : null

    if (requestedCheckIn && !parsedRequestedCheckIn) {
      return NextResponse.json(
        { success: false, message: 'Invalid requestedCheckIn format' },
        { status: 400 }
      )
    }

    if (requestedCheckOut && !parsedRequestedCheckOut) {
      return NextResponse.json(
        { success: false, message: 'Invalid requestedCheckOut format' },
        { status: 400 }
      )
    }

    const fullUser = await User.findById(user._id).populate({
      path: 'employeeId',
      options: { strictPopulate: false }
    }).lean()
    if (!fullUser?.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const employeeId = fullUser.employeeId._id

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
      requestedCheckIn: parsedRequestedCheckIn || undefined,
      requestedCheckOut: parsedRequestedCheckOut || undefined,
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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Department', 'Attendance', 'AttendanceCorrection', 'CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee, Department, Attendance, AttendanceCorrection, CompanySettings } = models

    const data = await request.json()
    const { correctionId, action, reviewerComments } = data

    if (!correctionId || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ success: false, message: 'Invalid request' }, { status: 400 })
    }

    if (!isValidObjectId(correctionId)) {
      return NextResponse.json(
        { success: false, message: 'Invalid correction ID' },
        { status: 400 }
      )
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
    const { canApprove, reason } = await canApproveCorrections(user._id, correction.employee, models)
    if (!canApprove) {
      return NextResponse.json({ success: false, message: reason || 'Unauthorized' }, { status: 403 })
    }

    const fullUser = await User.findById(user._id).populate({
      path: 'employeeId',
      options: { strictPopulate: false }
    }).lean()
    const reviewerEmployeeId = fullUser?.employeeId?._id

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
        const breakTimings = Array.isArray(settings?.breakTimings) ? settings.breakTimings : []
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
        console.log(`   Full Day Threshold: ${(fullDayHours * 0.8125).toFixed(1)}h (81.25% of ${fullDayHours}h)`)
        console.log(`   Early Checkout Threshold: ${(fullDayHours * 0.625).toFixed(1)}h (62.5% of ${fullDayHours}h)`)
        console.log(`   Calculated Status: ${calculatedStatus}`)
        console.log(`   Reason: ${statusReason}\n`)

      } else if (attendance.checkIn && !attendance.checkOut) {
        calculatedStatus = correction.requestedStatus || 'in-progress'
        statusReason = 'Check-in recorded; checkout is still pending'
      } else if (correction.requestedStatus && !attendance.checkIn && !attendance.checkOut) {
        // Only use requestedStatus when there's NO check-in/check-out at all
        calculatedStatus = correction.requestedStatus
        statusReason = 'Manual status set (no check-in/out times)'
      }

      // =====================================================
      // STEP 6: Update Attendance record (SOURCE OF TRUTH)
      // This is the CRITICAL update - all fields must be set here
      // =====================================================

      // Update only the fields owned by regularisation. A full document save
      // also validates unrelated historical fields and used to fail for legacy
      // autoCheckoutReason descriptions written before enum codes were adopted.
      const attendanceUpdate = {
        checkIn: attendance.checkIn,
        checkOut: attendance.checkOut,
        status: calculatedStatus,
        statusReason: `Corrected: ${statusReason}`,
        workHours: calculatedWorkHours,
        totalLoggedHours: attendance.totalLoggedHours || 0,
        breakMinutes: attendance.breakMinutes || 0,
        shrinkagePercentage: attendance.shrinkagePercentage || 0,
        isManualEntry: true,
        source: 'correction',
        remarks: `Corrected on ${new Date().toLocaleDateString('en-IN')} - ${correction.reason}`,
        createdBySystem: false,
        lastModifiedBy: user._id,
        approvedBy: reviewerEmployeeId || null,
        checkOutStatus: 'on-time',
        // Once a human approves the corrected record it is no longer an
        // auto-checkout result. Clearing these values also repairs legacy rows.
        autoCheckedOut: false,
        autoCheckoutReason: null,
        autoCheckoutAt: null,
      }

      const savedAttendance = await Attendance.findByIdAndUpdate(
        attendance._id,
        { $set: attendanceUpdate },
        { new: true, runValidators: true }
      ).lean()

      if (!savedAttendance) {
        return NextResponse.json({ success: false, message: 'Attendance record not found' }, { status: 404 })
      }

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

      // Emit sidebar counts update via eventBus
      try {
        emitEvent(EVENTS.ATTENDANCE_CORRECTION_CHANGED, {
          correctionId: correction._id.toString(),
          action: 'approved',
          employeeId: correction.employee.toString(),
          date: savedAttendance.date,
        }, {
          userIds: employeeUser ? [employeeUser._id.toString()] : [],
          databaseName: auth.tenant?.databaseName,
        })
      } catch (eventBusError) {
        console.error('Failed to emit eventBus correction event:', eventBusError)
      }

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

      // Emit sidebar counts update via eventBus
      try {
        emitEvent(EVENTS.ATTENDANCE_CORRECTION_CHANGED, {
          correctionId: correction._id.toString(),
          action: 'rejected',
          employeeId: correction.employee.toString(),
          date: correction.date,
        }, {
          userIds: employeeUser ? [employeeUser._id.toString()] : [],
          databaseName: auth.tenant?.databaseName,
        })
      } catch (eventBusError) {
        console.error('Failed to emit eventBus correction rejection event:', eventBusError)
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
