import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { logActivity } from '@/lib/activityLogger'
import { emitLeaveUpdate } from '@/lib/realtimeEvents'
import { buildDirectReportsFilter } from '@/lib/teamScope'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'
import { emitEvent, EVENTS } from '@/lib/eventBus'
import {
  calculateLeaveDays,
  normalizeLeaveBalance,
  normalizeLeaveRequest,
  normalizeLeaveRequests,
  parseDateOnly,
} from '@/lib/leaveData'
import { getHalfDayLimit } from '@/lib/halfDayPolicy'

// GET - List leave requests
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Leave', 'LeaveBalance', 'LeaveType', 'User', 'Employee', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Leave, LeaveBalance, LeaveType, User, Employee, Department } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status')
    const requestType = searchParams.get('requestType')

    // Get user record and role
    const userRecord = await User.findById(user._id || user.userId)
      .select('employeeId role isDepartmentHead headOfDepartments')
      .lean()
    
    const userRole = userRecord?.role || user.role
    const userEmployeeId = userRecord?.employeeId

    const query = {}

    // If specific employeeId is requested, user can only see their own leaves or those they can approve
    if (employeeId) {
      query.employee = employeeId
    }

    if (status) {
      query.status = status
    }
    if (requestType === 'work_from_home') {
      query.$or = [{ requestType }, { workFromHome: true }]
    } else if (requestType) {
      query.requestType = requestType
    }

    // Role-based filtering for pending approvals
    // When fetching pending leaves without a specific employeeId, scope based on role
    if (status === 'pending' && !employeeId) {
      // Admin sees all pending leaves
      if (userRole === 'admin') {
        // No additional filter - admin sees everything
      }
      // HR users should ONLY see approvals if they're a department head (for their department)
      // Regular HR employees should NOT see pending approvals - their dept head handles their leaves
      else if (userRole === 'hr') {
        if (userRecord?.isDepartmentHead && userRecord?.headOfDepartments?.length > 0) {
          // HR who is dept head - only see their department's leaves
          const deptEmployees = await Employee.find({ 
            department: { $in: userRecord.headOfDepartments },
            _id: { $ne: userEmployeeId } // Exclude own leaves
          }).select('_id').lean()
          const deptEmployeeIds = deptEmployees.map(e => e._id)
          query.employee = { $in: deptEmployeeIds }
        } else {
          // Regular HR (not dept head) - should not see pending approvals
          // Return empty - they can only see their own leaves via employeeId filter
          return NextResponse.json({
            success: true,
            data: [],
            message: 'Only your department head can approve leave requests'
          })
        }
      }
      // Department heads see their department's leaves
      else if (userRole === 'department_head' || userRecord?.isDepartmentHead) {
        let deptIds = []
        
        // Check headOfDepartments on User model
        if (userRecord?.headOfDepartments?.length > 0) {
          deptIds = userRecord.headOfDepartments
        } else if (userEmployeeId) {
          // Fallback to Department.head or Department.heads
          const managedDepts = await Department.find({
            $or: [
              { head: userEmployeeId },
              { heads: userEmployeeId }
            ]
          }).select('_id').lean()
          deptIds = managedDepts.map(d => d._id)
        }
        
        if (deptIds.length > 0) {
          const deptEmployees = await Employee.find({ 
            department: { $in: deptIds },
            _id: { $ne: userEmployeeId } // Exclude own leaves
          }).select('_id').lean()
          const deptEmployeeIds = deptEmployees.map(e => e._id)
          query.employee = { $in: deptEmployeeIds }
        } else {
          // Not actually a dept head - return empty
          return NextResponse.json({
            success: true,
            data: [],
            message: 'No department assigned'
          })
        }
      }
      // Managers see their direct reports' leaves
      else if (userRole === 'manager' && userEmployeeId) {
        const directReports = await Employee.find({
          ...buildDirectReportsFilter(userEmployeeId),
          _id: { $ne: userEmployeeId }
        }).select('_id').lean()
        const reportIds = directReports.map(e => e._id)
        query.employee = { $in: reportIds }
      }
      // Regular employees should not see pending approvals
      else {
        return NextResponse.json({
          success: true,
          data: [],
          message: 'Only department heads and admins can approve leave requests'
        })
      }
    }

    const leaves = await Leave.find(query)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('leaveType', 'name')
      .populate('approvedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean()

    return NextResponse.json({
      success: true,
      data: normalizeLeaveRequests(leaves),
    })
  } catch (error) {
    console.error('Get leaves error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch leaves' },
      { status: 500 }
    )
  }
}

// POST - Apply for leave
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['Leave', 'LeaveBalance', 'LeaveType', 'User', 'Employee', 'CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models, tenant } = auth
    const { Leave, LeaveBalance, LeaveType, User, Employee, CompanySettings } = models
    const data = await request.json()

    const userRecord = await User.findById(user._id || user.userId)
      .select('employeeId')
      .lean()
    const employeeId = userRecord?.employeeId || user.employeeId

    if (!employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee information was not found for this account' },
        { status: 400 }
      )
    }

    if (data.employee && String(data.employee) !== String(employeeId)) {
      return NextResponse.json(
        { success: false, message: 'You can only apply for leave for your own employee account' },
        { status: 403 }
      )
    }

    const startDate = parseDateOnly(data.startDate)
    const endDate = parseDateOnly(data.endDate || data.startDate)
    const numberOfDays = calculateLeaveDays(data.startDate, data.endDate || data.startDate, data.isHalfDay)

    if (!startDate || !endDate || numberOfDays <= 0) {
      return NextResponse.json(
        { success: false, message: 'Please select a valid start and end date' },
        { status: 400 }
      )
    }

    if (startDate.getUTCFullYear() !== endDate.getUTCFullYear()) {
      return NextResponse.json(
        { success: false, message: 'A leave request cannot span two balance years. Please submit one request per year.' },
        { status: 400 }
      )
    }

    if (!String(data.reason || '').trim()) {
      return NextResponse.json(
        { success: false, message: 'Reason for leave is required' },
        { status: 400 }
      )
    }

    const requestType = data.requestType
      || (data.isHalfDay ? 'half_day' : data.workFromHome ? 'work_from_home' : 'leave')
    const isSpecialRequest = ['half_day', 'work_from_home', 'early_leave'].includes(requestType)

    if (requestType === 'early_leave' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(data.earlyLeaveTime || ''))) {
      return NextResponse.json(
        { success: false, message: 'Please select a valid early leave time' },
        { status: 400 }
      )
    }

    if (requestType === 'half_day') {
      const employee = await Employee.findById(employeeId).select('designationLevel').lean()
      const settings = await CompanySettings.findOne().select('leave.halfDayPolicy').lean()
      const annualLimit = getHalfDayLimit(settings?.leave?.halfDayPolicy, employee?.designationLevel)
      const yearStart = new Date(Date.UTC(startDate.getUTCFullYear(), 0, 1))
      const yearEnd = new Date(Date.UTC(startDate.getUTCFullYear() + 1, 0, 1))
      const committedHalfDays = await Leave.countDocuments({
        employee: employeeId,
        isHalfDay: true,
        status: { $in: ['pending', 'approved'] },
        startDate: { $gte: yearStart, $lt: yearEnd },
      })

      if (committedHalfDays >= annualLimit) {
        return NextResponse.json(
          { success: false, message: `No half-day balance remains for ${startDate.getUTCFullYear()}` },
          { status: 400 }
        )
      }
    }
    if (!data.leaveType && !isSpecialRequest) {
      return NextResponse.json(
        { success: false, message: 'Leave type is required' },
        { status: 400 }
      )
    }

    let leaveBalance = null
    if (data.leaveType) {
      if (!/^[a-f\d]{24}$/i.test(String(data.leaveType))) {
        return NextResponse.json(
          { success: false, message: 'The selected leave type is invalid' },
          { status: 400 }
        )
      }

      const leaveType = await LeaveType.findOne({ _id: data.leaveType, isActive: true })
        .select('_id name')
        .lean()

      if (!leaveType) {
        return NextResponse.json(
          { success: false, message: 'The selected leave type is not available' },
          { status: 400 }
        )
      }

      leaveBalance = await LeaveBalance.findOne({
        employee: employeeId,
        leaveType: data.leaveType,
        year: startDate.getUTCFullYear(),
      }).lean()

      if (!leaveBalance) {
        return NextResponse.json(
          { success: false, message: 'No leave balance is allocated for the selected leave type and year' },
          { status: 400 }
        )
      }

      const normalizedBalance = normalizeLeaveBalance(leaveBalance)
      if (normalizedBalance.remainingDays < numberOfDays) {
        return NextResponse.json(
          {
            success: false,
            message: `Insufficient leave balance. Available: ${normalizedBalance.remainingDays} day(s)`,
          },
          { status: 400 }
        )
      }
    }

    // Create leave request
    const leave = await Leave.create({
      employee: employeeId,
      leaveType: data.leaveType || undefined,
      startDate,
      endDate,
      numberOfDays,
      days: numberOfDays,
      reason: String(data.reason).trim(),
      requestType,
      isHalfDay: requestType === 'half_day',
      halfDayPeriod: data.halfDayPeriod,
      workFromHome: requestType === 'work_from_home',
      earlyLeaveTime: requestType === 'early_leave' ? data.earlyLeaveTime : undefined,
      emergencyContact: data.emergencyContact,
      handoverNotes: data.handoverNotes,
      status: 'pending',
    })

    const populatedLeave = await Leave.findById(leave._id)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('leaveType', 'name')
      .lean()
    const responseLeave = normalizeLeaveRequest(populatedLeave)

    // Log activity for leave application
    await logActivity({
      employeeId,
      type: 'leave_apply',
      action: 'Applied for leave',
      details: `${numberOfDays} day(s) leave from ${data.startDate} to ${data.endDate || data.startDate}`,
      metadata: {
        leaveType: data.leaveType,
        numberOfDays
      },
      relatedModel: 'Leave',
      relatedId: leave._id
    })

    const tenantId = tenant?.databaseName
    const currentUserId = String(user._id || user.userId)
    try {
      await Promise.all([
        clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:unified', userId: '*' })),
        clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:employee-stats', userId: currentUserId })),
        clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:manager-stats', userId: '*' })),
        clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:hr-stats', userId: '*' })),
      ])
    } catch (cacheError) {
      console.error('Failed to clear leave application caches:', cacheError)
    }

    // Emit real-time leave update to admins/HR/managers
    try {
      const adminUsers = await User.find({
        role: { $in: ['admin', 'hr', 'manager', 'department_head'] },
        isActive: true,
      }).select('_id').lean()
      const targetUserIds = [...new Set([
        currentUserId,
        ...adminUsers.map(adminUser => adminUser._id.toString()),
      ])]

      emitLeaveUpdate(
        {
          _id: leave._id,
          employee: responseLeave.employee,
          leaveType: responseLeave.leaveType,
          startDate: leave.startDate,
          endDate: leave.endDate,
          numberOfDays,
          status: leave.status,
          reason: leave.reason
        },
        targetUserIds,
        { isNew: true, action: 'request' }
      )
    } catch (emitError) {
      console.error('Failed to emit leave update:', emitError)
    }

    try {
      emitEvent(EVENTS.LEAVE_STATUS_CHANGED, {
        leaveId: leave._id.toString(),
        status: leave.status,
        employeeId: String(employeeId),
      }, {
        userIds: [currentUserId],
        databaseName: tenantId,
      })
    } catch (eventBusError) {
      console.error('Failed to emit leave application event:', eventBusError)
    }

    return NextResponse.json({
      success: true,
      message: requestType === 'work_from_home'
        ? 'Work from home request submitted successfully'
        : requestType === 'early_leave'
          ? 'Early leave request submitted successfully'
          : 'Leave request submitted successfully',
      data: responseLeave,
    }, { status: 201 })
  } catch (error) {
    console.error('Apply leave error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to apply for leave' },
      { status: 500 }
    )
  }
}

