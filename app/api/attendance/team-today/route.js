import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildDirectReportsFilter } from '@/lib/teamScope'

export const dynamic = 'force-dynamic'

// GET - Get team attendance for today with proper status calculation
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Attendance', 'Employee', 'User', 'Leave', 'CompanySettings', 'Department', 'Team'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    if (!auth.models) {
      return NextResponse.json({ success: false, message: 'Failed to load database models' }, { status: 500 })
    }
    const { user, models } = auth
    const { Attendance, Employee, User, Leave, CompanySettings, Department, Team } = models

    if (!Attendance || !Employee || !User || !Leave || !CompanySettings) {
      return NextResponse.json({ success: false, message: 'Failed to load required models' }, { status: 500 })
    }

    // Get the requesting user with employee info and department head data
    const requestingUser = await User.findById(user._id)
      .populate({
        path: 'employeeId',
        options: { strictPopulate: false }
      })
      .select('role employeeId isDepartmentHead headOfDepartments teamLeaderOf')
      .lean()
    if (!requestingUser) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    const isAdmin = ['admin', 'hr'].includes(requestingUser.role)

    // Get company settings for threshold calculation
    const settings = await CompanySettings.findOne().lean()
    const checkInTime = settings?.checkInTime || '09:00'
    const absentThresholdMinutes = settings?.absentThresholdMinutes || 60

    // Calculate threshold time
    const now = new Date()
    const [checkInHour, checkInMinute] = checkInTime.split(':').map(Number)
    const officeStart = new Date(now)
    officeStart.setHours(checkInHour, checkInMinute, 0, 0)
    const absentThresholdTime = new Date(officeStart)
    absentThresholdTime.setMinutes(absentThresholdTime.getMinutes() + absentThresholdMinutes)

    // Determine if we're past the absent threshold
    const isPastThreshold = now >= absentThresholdTime
    const isBeforeOfficeStart = now < officeStart

    // Get today's date range
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Get employees based on role
    let employees
    if (isAdmin) {
      employees = await Employee.find({ status: 'active' })
        .select('firstName lastName profilePicture department')
        .lean()
    } else {
      // Get team members for department heads and managers
      const requestingEmployee = requestingUser.employeeId
      if (!requestingEmployee) {
        return NextResponse.json({ success: true, data: [] })
      }

      // Check if user is a department head via User.headOfDepartments (supports multiple departments)
      let departmentIds = []
      
      if (requestingUser.isDepartmentHead && requestingUser.headOfDepartments?.length > 0) {
        departmentIds = requestingUser.headOfDepartments.map(d => d.toString())
      } else {
        // Fallback: Check Department.head or Department.heads
        const headDepartments = await Department.find({
          isActive: true,
          $or: [
            { head: requestingEmployee._id },
            { heads: requestingEmployee._id }
          ]
        }).select('_id').lean()
        
        if (headDepartments.length > 0) {
          departmentIds = headDepartments.map(d => d._id.toString())
        }
      }

      if (departmentIds.length > 0) {
        // User is department head - get employees from ALL departments they head
        employees = await Employee.find({
          status: 'active',
          department: { $in: departmentIds }
        })
          .select('firstName lastName profilePicture department')
          .lean()
      } else if (requestingUser.teamLeaderOf?.length > 0 && Team) {
        // Check if user is a team leader
        const ledTeams = await Team.find({
          _id: { $in: requestingUser.teamLeaderOf },
          isActive: true
        }).select('members teamLeaders').lean()

        if (ledTeams.length > 0) {
          const teamEmployeeIds = new Set()
          for (const team of ledTeams) {
            for (const m of (team.members || [])) teamEmployeeIds.add(m.toString())
            for (const l of (team.teamLeaders || [])) teamEmployeeIds.add(l.toString())
          }
          employees = await Employee.find({
            _id: { $in: [...teamEmployeeIds] },
            status: 'active'
          })
            .select('firstName lastName profilePicture department')
            .lean()
        }
      } else {
        // Fallback for managers: any direct report (assignedManager / TL / reportsTo / reportingManager) +
        // anyone else in the same department.
        const directReportsClause = buildDirectReportsFilter(requestingEmployee._id)
        const orClauses = [{ department: requestingEmployee.department }]
        if (directReportsClause) orClauses.unshift(...directReportsClause.$or)
        employees = await Employee.find({
          status: 'active',
          $or: orClauses,
        })
          .select('firstName lastName profilePicture department')
          .lean()
      }
    }

    if (!employees || employees.length === 0) {
      return NextResponse.json({ success: true, data: [] })
    }

    const employeeIds = employees.map(e => e._id)

    // Get today's attendance records
    const todayAttendance = await Attendance.find({
      employee: { $in: employeeIds },
      date: { $gte: today, $lt: tomorrow }
    }).lean()

    // Get employees on leave today
    const leavesToday = await Leave.find({
      employee: { $in: employeeIds },
      status: 'approved',
      workFromHome: { $ne: true },
      requestType: { $ne: 'early_leave' },
      startDate: { $lte: today },
      endDate: { $gte: today }
    }).select('employee').lean()

    const onLeaveIds = new Set(leavesToday.map(l => l.employee.toString()))

    // Create a map of attendance by employee ID
    const attendanceMap = new Map()
    todayAttendance.forEach(att => {
      attendanceMap.set(att.employee.toString(), att)
    })

    // Build the response with calculated status
    const teamData = employees.map(emp => {
      const empId = emp._id.toString()
      const attendance = attendanceMap.get(empId)
      const isOnLeave = onLeaveIds.has(empId)

      let status
      if (isOnLeave) {
        status = 'on-leave'
      } else if (attendance) {
        // Has attendance record
        status = attendance.status
      } else {
        // No attendance record - calculate based on time
        if (isBeforeOfficeStart) {
          status = 'not-started'
        } else if (isPastThreshold) {
          status = 'absent'
        } else {
          status = 'not-checked-in'
        }
      }

      return {
        _id: emp._id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        profilePicture: emp.profilePicture,
        status,
        checkIn: attendance?.checkIn || null,
        checkOut: attendance?.checkOut || null,
        workHours: attendance?.workHours || 0
      }
    })

    return NextResponse.json({
      success: true,
      data: teamData,
      meta: {
        total: teamData.length,
        present: teamData.filter(e => e.status === 'present' || e.status === 'in-progress').length,
        absent: teamData.filter(e => e.status === 'absent').length,
        onLeave: teamData.filter(e => e.status === 'on-leave').length,
        notCheckedIn: teamData.filter(e => e.status === 'not-checked-in').length,
        isPastThreshold,
        absentThresholdMinutes
      }
    })
  } catch (error) {
    console.error('Team today attendance error:', error)
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    )
  }
}
