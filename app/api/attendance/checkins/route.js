import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// Mark this route as dynamic
export const dynamic = 'force-dynamic'

// GET - Get employee check-ins for a specific date (Admin only)
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Attendance', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Attendance, Employee } = models

    // Only admin can view all employee check-ins
    if (user.role !== 'admin') {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const dateParam = searchParams.get('date')

    // Default to today if no date provided
    const targetDate = dateParam ? new Date(dateParam) : new Date()
    targetDate.setHours(0, 0, 0, 0)

    const nextDay = new Date(targetDate)
    nextDay.setDate(nextDay.getDate() + 1)

    // Get all employees
    const allEmployees = await Employee.find({ status: 'active' })
      .populate('department', 'name')
      .populate('company', 'timezone')
      .select('employeeCode firstName lastName email department company')

    // Get attendance records for the date
    const attendanceRecords = await Attendance.find({
      date: {
        $gte: targetDate,
        $lt: nextDay
      }
    }).populate({
      path: 'employee',
      select: 'employeeCode firstName lastName email department company',
      populate: { path: 'company', select: 'timezone' }
    })

    // Create a map of employee attendance
    const attendanceMap = new Map()
    attendanceRecords.forEach(record => {
      if (record.employee) {
        attendanceMap.set(record.employee._id.toString(), record)
      }
    })

    // Create complete check-in data including absent employees
    const checkinData = allEmployees.map(employee => {
      const attendance = attendanceMap.get(employee._id.toString())

      if (attendance) {
        return {
          _id: attendance._id,
          employee: {
            _id: employee._id,
            employeeCode: employee.employeeCode,
            firstName: employee.firstName,
            lastName: employee.lastName,
            email: employee.email,
            department: employee.department,
            companyTimezone: employee.company?.timezone || 'Asia/Kolkata'
          },
          date: attendance.date,
          checkInTime: attendance.checkIn,
          checkOutTime: attendance.checkOut,
          checkInStatus: attendance.checkInStatus,
          checkOutStatus: attendance.checkOutStatus,
          status: attendance.status,
          workHours: attendance.workHours,
          notes: attendance.notes,
          location: attendance.location // Include location data
        }
      } else {
        // Employee is absent
        return {
          _id: `absent-${employee._id}`,
          employee: {
            _id: employee._id,
            employeeCode: employee.employeeCode,
            firstName: employee.firstName,
            lastName: employee.lastName,
            email: employee.email,
            department: employee.department,
            companyTimezone: employee.company?.timezone || 'Asia/Kolkata'
          },
          date: targetDate,
          checkInTime: null,
          checkOutTime: null,
          checkInStatus: null,
          checkOutStatus: null,
          status: 'absent',
          workHours: 0,
          notes: 'No attendance record'
        }
      }
    })

    // Sort by status (in-progress first, then present, then half-day, then absent)
    checkinData.sort((a, b) => {
      const statusOrder = { 'in-progress': 1, 'present': 2, 'half-day': 3, 'absent': 4 }
      return statusOrder[a.status] - statusOrder[b.status]
    })

    return NextResponse.json({
      success: true,
      data: checkinData,
      summary: {
        total: checkinData.length,
        present: checkinData.filter(c => c.status === 'present').length,
        inProgress: checkinData.filter(c => c.status === 'in-progress').length,
        absent: checkinData.filter(c => c.status === 'absent').length,
        halfDay: checkinData.filter(c => c.status === 'half-day').length,
        date: targetDate.toISOString()
      }
    })
  } catch (error) {
    console.error('Get check-ins error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch check-ins' },
      { status: 500 }
    )
  }
}
