import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Holiday', 'Employee', 'Attendance'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Holiday, Employee, Attendance } = models

    // Get current year
    const currentYear = new Date().getFullYear()
    const startDate = new Date(currentYear, 0, 1)
    const endDate = new Date(currentYear, 11, 31, 23, 59, 59)

    // Fetch holidays for current year
    const holidays = await Holiday.find({
      date: { $gte: startDate, $lte: endDate },
      isActive: true
    })

    if (holidays.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No holidays found to sync'
      })
    }

    // Fetch all active employees
    const employees = await Employee.find({ status: 'active' }).select('_id')

    let createdCount = 0
    let updatedCount = 0

    for (const holiday of holidays) {
      const holidayDate = new Date(holiday.date)
      // Reset time to start of day for comparison
      holidayDate.setHours(0, 0, 0, 0)

      // Determine applicable employees
      // If applicableTo is 'all', then all employees
      // If 'specific-locations', we would need to check employee location (not implemented fully here, assuming all for now or skipping)
      
      // For simplicity in this sync, we'll apply to all employees if applicableTo is 'all'
      // If specific locations, we'd need to match employee location.
      
      let targetEmployees = employees
      
      // TODO: Filter by location if needed
      
      for (const employee of targetEmployees) {
        // Check if attendance exists
        const existingAttendance = await Attendance.findOne({
          employee: employee._id,
          date: {
            $gte: holidayDate,
            $lt: new Date(holidayDate.getTime() + 24 * 60 * 60 * 1000)
          }
        })

        if (existingAttendance) {
          // If exists and status is absent or not set, update to holiday
          if (existingAttendance.status === 'absent' || !existingAttendance.status) {
            existingAttendance.status = 'holiday'
            existingAttendance.statusReason = holiday.name
            await existingAttendance.save()
            updatedCount++
          }
        } else {
          // Create new attendance record
          await Attendance.create({
            employee: employee._id,
            date: holidayDate,
            status: 'holiday',
            statusReason: holiday.name,
            workHours: 0
          })
          createdCount++
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Synced successfully. Created ${createdCount} records, updated ${updatedCount} records.`
    })

  } catch (error) {
    console.error('Sync holidays error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to sync holidays' },
      { status: 500 }
    )
  }
}
