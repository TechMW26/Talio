import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET - Get team attendance for today with proper status calculation
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Attendance', 'Employee', 'User', 'Leave', 'CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Attendance, Employee, User, Leave, CompanySettings } = models

    // Get the requesting user with employee info
    const requestingUser = await User.findById(user._id).populate({
      path: 'employeeId',
      options: { strictPopulate: false }
    }).lean()
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
      // Get team members for managers
      const requestingEmployee = requestingUser.employeeId
      if (!requestingEmployee) {
        return NextResponse.json({ success: true, data: [] })
      }

      employees = await Employee.find({
        status: 'active',
        $or: [
          { reportingManager: requestingEmployee._id },
          { department: requestingEmployee.department }
        ]
      })
        .select('firstName lastName profilePicture department')
        .lean()
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
