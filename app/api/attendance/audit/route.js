import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ATTENDANCE_DATABASE_OPTIONS, attendanceError } from '@/lib/platform/firestoreAttendance.server'
import { getProductivityVisibility, queryProductivityByIds } from '@/lib/platform/firestoreProductivityView.server'
import { getStartOfDayInTimezone, getEndOfDayInTimezone } from '@/lib/timezone'
export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, ATTENDANCE_DATABASE_OPTIONS)
    if (!auth.success) throw attendanceError(auth.message, 401)
    if (!['admin','hr','manager'].includes(auth.user.role)) throw attendanceError('Admin, HR, or Manager access required', 403)
    const { database, user } = auth, params = new URL(request.url).searchParams, employeeId = params.get('employeeId')
    const date = params.get('date'), start = date || params.get('startDate'), end = date || params.get('endDate')
    if ([start,end].some(v => v && Number.isNaN(+new Date(v)))) throw attendanceError('Invalid date')
    if (employeeId && !/^[a-f0-9]{24}$/.test(employeeId)) throw attendanceError('Invalid employee ID')
    const startDate = getStartOfDayInTimezone(start || new Date(Date.now()-31*86400000), 'Asia/Kolkata'), endDate = getEndOfDayInTimezone(end || new Date(), 'Asia/Kolkata')
    if (endDate < startDate || endDate-startDate > 366*86400000) throw attendanceError('Select a date range of at most one year')
    const { employees: visible } = await getProductivityVisibility(database, user, { includeSelf: true })
    const employees = visible.filter(e=>!employeeId || e._id === employeeId), employeeMap = new Map(employees.map(e=>[e._id,e]))
    const all = await queryProductivityByIds(database, 'attendances', 'employee', employees.map(e=>e._id), [{ field: 'date', operator: '>=', value: startDate }, { field: 'date', operator: '<=', value: endDate }])
    const isSystem = record => record.createdBySystem || ['system_auto_absent','system_backfill'].includes(record.source)
    const source = params.get('source'), systemOnly = params.get('onlySystemGenerated') === 'true'
    const records = all.filter(r=>(!source || r.source === source) && (!systemOnly || isSystem(r))).sort((a,b)=>new Date(b.date)-new Date(a.date) || new Date(b.createdAt)-new Date(a.createdAt))
    const page = Math.max(1, parseInt(params.get('page'),10) || 1), limit = Math.min(200, Math.max(1, parseInt(params.get('limit'),10) || 50)), bySource = {}
    for (const record of records) bySource[record.source || 'unknown'] = (bySource[record.source || 'unknown'] || 0) + 1
    const selected = await Promise.all(records.slice((page-1)*limit,page*limit).map(async r => {
      const e = employeeMap.get(r.employee), creator = r.createdBy ? await database.get('users', String(r.createdBy)) : null, updater = r.lastModifiedBy ? await database.get('users', String(r.lastModifiedBy)) : null
      return { _id:r._id, date:r.date, employee:e?{_id:e._id,name:[e.firstName,e.lastName].filter(Boolean).join(' '),email:e.email,employeeCode:e.employeeCode}:null,status:r.status,checkIn:r.checkIn,checkOut:r.checkOut,workHours:r.workHours,statusReason:r.statusReason,remarks:r.remarks,source:r.source||'user_checkin',isSystemGenerated:Boolean(isSystem(r)),isManualEntry:r.isManualEntry,createdBy:creator?.email,lastModifiedBy:updater?.email,createdAt:r.createdAt,updatedAt:r.updatedAt }
    }))
    return NextResponse.json({ success:true,data:{records:selected,pagination:{page,limit,total:records.length,totalPages:Math.ceil(records.length/limit)},summary:{total:records.length,bySource}} })
  } catch(error) { return NextResponse.json({ success:false,message:error.message },{status:error.status||500}) }
}
