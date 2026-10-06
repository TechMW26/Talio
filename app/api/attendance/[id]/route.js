import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ATTENDANCE_DATABASE_OPTIONS, attendanceId, attendanceError } from '@/lib/platform/firestoreAttendance.server'
import { getProductivityVisibility } from '@/lib/platform/firestoreProductivityView.server'
export const dynamic = 'force-dynamic'
const failure = error => NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 })
async function context(request, params, write = false) {
  const { id } = await params
  if (!/^[a-f0-9]{24}$/.test(id || '')) throw attendanceError('Invalid attendance record ID')
  const auth = await getAuthAndDatabase(request, ATTENDANCE_DATABASE_OPTIONS)
  if (!auth.success) throw attendanceError(auth.message || 'Unauthorized', 401)
  if (write && !['admin', 'hr', 'owner', 'superadmin'].includes(auth.user.role)) throw attendanceError('Admin or HR access required', 403)
  const record = await auth.database.get('attendances', id)
  if (!record) throw attendanceError('Attendance record not found', 404)
  if (!write) {
    const scope = await getProductivityVisibility(auth.database, auth.user, { includeSelf: true })
    if (!scope.employees.some(e => e._id === attendanceId(record.employee))) throw attendanceError('Access denied', 403)
  }
  return { ...auth, id, record }
}
async function populate(database, record) {
  const employee = await database.get('employees', attendanceId(record.employee))
  return { ...record, employee: employee ? { _id: employee._id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode } : null }
}
export async function GET(request, { params }) {
  try { const { database, record } = await context(request, params); return NextResponse.json({ success: true, data: await populate(database, record) }) }
  catch(error) { return failure(error) }
}
export async function PUT(request, { params }) {
  try {
    const { database, user, id } = await context(request, params, true), body = await request.json()
    const fields = {}
    for (const field of ['checkIn', 'checkOut']) if (body[field] !== undefined) {
      fields[field] = body[field] ? new Date(body[field]) : null
      if (fields[field] && Number.isNaN(+fields[field])) throw attendanceError('Invalid ' + field)
    }
    if (body.status !== undefined) { if (!['present','absent','half-day','late','on-leave','holiday','weekend','in-progress'].includes(body.status)) throw attendanceError('Invalid status'); fields.status = body.status }
    for (const field of ['workHours', 'overtime']) if (body[field] !== undefined) { if (!Number.isFinite(+body[field]) || +body[field] < 0 || +body[field] > 48) throw attendanceError('Invalid hours'); fields[field] = +body[field] }
    if (body.remarks !== undefined) fields.remarks = String(body.remarks).slice(0, 10000)
    const record = await database.mutate('attendances', id, current => {
      const next = { ...current, ...fields, correctedAt: new Date(), correctedBy: attendanceId(user._id || user.userId), isManualEntry: true, source: 'correction', updatedAt: new Date() }
      if (next.checkOut && (!next.checkIn || next.checkOut <= next.checkIn)) throw attendanceError('Checkout must follow check-in')
      return next
    })
    if (!record) throw attendanceError('Attendance record not found', 404)
    return NextResponse.json({ success: true, message: 'Attendance updated successfully', data: await populate(database, record) })
  } catch(error) { return failure(error) }
}
export async function DELETE(request, { params }) {
  try {
    const { database, id } = await context(request, params, true)
    await database.transaction(async tx => {
      if (!await tx.get('attendances', id)) throw attendanceError('Attendance record not found', 404)
      await tx.delete('attendances', id)
    })
    return NextResponse.json({ success: true, message: 'Attendance deleted successfully' })
  } catch(error) { return failure(error) }
}

