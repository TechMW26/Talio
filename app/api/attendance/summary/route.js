import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ATTENDANCE_DATABASE_OPTIONS, attendanceError } from '@/lib/platform/firestoreAttendance.server'
import { getProductivityVisibility, queryProductivityByIds } from '@/lib/platform/firestoreProductivityView.server'
import { getDateKeyInTimezone, getStartOfDayInTimezone, getEndOfDayInTimezone } from '@/lib/timezone'
export const dynamic = 'force-dynamic'
function totals(records) {
  return { present: records.filter(r => ['present', 'late', 'in-progress'].includes(r.status)).length, absent: records.filter(r => r.status === 'absent').length,
    late: records.filter(r => r.checkInStatus === 'late').length, halfDay: records.filter(r => r.status === 'half-day').length, onLeave: records.filter(r => r.status === 'on-leave').length, total: records.length }
}
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, ATTENDANCE_DATABASE_OPTIONS)
    if (!auth.success) throw attendanceError(auth.message || 'Unauthorized', 401)
    const { database, user } = auth, params = new URL(request.url).searchParams, employeeId = params.get('employeeId')
    const ownEmployeeId = String(user.employeeId?._id || user.employeeId || '')
    const canReadDirectly = employeeId && (employeeId === ownEmployeeId || ['admin', 'hr', 'owner', 'superadmin', 'super_admin'].includes(user.role))
    // The database is already tenant-bound and the account freshly authorized.
    // Self/admin requests need one employee lookup, not the complete org chart.
    const employees = canReadDirectly
      ? [await database.get('employees', employeeId)].filter(Boolean)
      : (await getProductivityVisibility(database, user, { includeSelf: true })).employees.filter(e => !employeeId || e._id === employeeId)
    if (employeeId && !employees.length) throw attendanceError('Employee not found or access denied', 403)
    const timezone = 'Asia/Kolkata', now = new Date(), today = getDateKeyInTimezone(now, timezone)
    const days = params.has('days') ? Number(params.get('days')) : 7
    if (!Number.isInteger(days) || days < 1 || days > 365) throw attendanceError('Invalid days parameter')
    const monthStart = getStartOfDayInTimezone(today.slice(0, 7) + '-01', timezone)
    const startDate = employeeId ? monthStart : new Date(getStartOfDayInTimezone(now, timezone).getTime() - days * 86400000)
    const endDate = getEndOfDayInTimezone(now, timezone)
    const records = await queryProductivityByIds(database, 'attendances', 'employee', employees.map(e => e._id), [{ field: 'date', operator: '>=', value: startDate }, { field: 'date', operator: '<=', value: endDate }])
    if (employeeId) {
      const summary = totals(records), worked = records.filter(r => Number(r.workHours || r.totalLoggedHours) > 0)
      return NextResponse.json({ success: true, data: { presentDays: summary.present + summary.halfDay, absentDays: summary.absent, lateDays: summary.late,
        avgHours: worked.length ? (worked.reduce((sum,r) => sum + Number(r.workHours || r.totalLoggedHours || 0), 0) / worked.length).toFixed(1) : '0', month: now.toLocaleString('en-US', { month: 'long', timeZone: timezone }) } })
    }
    const groups = new Map()
    for (const record of records) { const key = getDateKeyInTimezone(record.date, timezone); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(record) }
    const chartData = [...groups].sort(([a],[b]) => a.localeCompare(b)).map(([date, rows]) => ({ name: new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: timezone }), date, ...totals(rows) }))
    const summary = totals(records), current = groups.get(today) || [], todaySummary = totals(current)
    const active = employees.filter(e => e.status === 'active'), activeIds = new Set(active.map(e=>e._id))
    const missing = active.filter(e => !current.some(r => r.employee === e._id)).length
    return NextResponse.json({ success: true, data: {
      chartData, summary: { totalEmployees: active.length, attendanceRate: summary.total ? Number(((summary.present + summary.halfDay) / summary.total * 100).toFixed(1)) : 0,
        totalPresent: summary.present, totalAbsent: summary.absent, totalLate: summary.late, totalHalfDay: summary.halfDay, totalRecords: summary.total },
      today: { ...todaySummary, absent: todaySummary.absent + missing, total: active.length, attendanceRate: active.length ? Math.min(100, Number(((current.filter(r => activeIds.has(r.employee) && ['present','late','in-progress'].includes(r.status)).length + current.filter(r => activeIds.has(r.employee) && r.status === 'half-day').length * .5) / active.length * 100).toFixed(1))) : 0 },
      dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString(), days }
    } })
  } catch(error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) }
}
