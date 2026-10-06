import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ATTENDANCE_DATABASE_OPTIONS, listAttendanceRecords, populateAttendanceEmployee, attendanceError } from '@/lib/platform/firestoreAttendance.server'
import { getAttendanceDayRange } from '@/lib/attendanceAutoCheckout'
export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, ATTENDANCE_DATABASE_OPTIONS)
    if (!auth.success) throw attendanceError(auth.message, 401)
    if (auth.user.role !== 'admin') throw attendanceError('Access denied', 403)
    const value = new URL(request.url).searchParams.get('date'), date = value ? new Date(value) : new Date()
    if (Number.isNaN(+date)) throw attendanceError('Invalid date')
    const range = getAttendanceDayRange(date, 'Asia/Kolkata')
    const [employees, records] = await Promise.all([listAttendanceRecords(auth.database, 'employees', [{ field: 'status', operator: '==', value: 'active' }]), listAttendanceRecords(auth.database, 'attendances', [{ field: 'date', operator: '>=', value: range.start }, { field: 'date', operator: '<=', value: range.end }])])
    const map = new Map(records.map(r => [r.employee, r]))
    const data = await Promise.all(employees.map(async employee => {
      const e = await populateAttendanceEmployee(auth.database, employee), record = map.get(e._id)
      return { _id: record?._id || 'absent-' + e._id, employee: { _id: e._id, employeeCode: e.employeeCode, firstName: e.firstName, lastName: e.lastName, email: e.email, department: e.department ? { _id: e.department._id, name: e.department.name } : null, companyTimezone: e.company?.timezone || 'Asia/Kolkata' },
        date: record?.date || range.start, checkInTime: record?.checkIn || null, checkOutTime: record?.checkOut || null, checkInStatus: record?.checkInStatus || null, checkOutStatus: record?.checkOutStatus || null,
        status: record?.status || 'absent', workHours: record?.workHours || 0, notes: record?.notes || (record ? '' : 'No attendance record'), ...(record?.location ? { location: record.location } : {}) }
    }))
    const priority = { 'in-progress': 1, present: 2, 'half-day': 3, absent: 4 }
    data.sort((a,b) => (priority[a.status] || 5) - (priority[b.status] || 5))
    return NextResponse.json({ success: true, data, summary: { total: data.length, present: data.filter(r=>r.status === 'present').length, inProgress: data.filter(r=>r.status === 'in-progress').length, absent: data.filter(r=>r.status === 'absent').length, halfDay: data.filter(r=>r.status === 'half-day').length, date: range.start.toISOString() } })
  } catch(error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) }
}
