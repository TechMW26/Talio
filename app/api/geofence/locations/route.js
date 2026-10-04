import { NextResponse } from 'next/server'
import { geofenceContext, assertGeofenceId, saveGeofenceLocation, populateGeofenceRecord } from '@/lib/platform/firestoreGeofence.server'
import { listAttendanceRecords, attendanceId } from '@/lib/platform/firestoreAttendance.server'
const failure = error => NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 })
export async function GET(request) {
  try {
    const { database } = await geofenceContext(request)
    const params = new URL(request.url).searchParams, company = params.get('company')
    if (company) assertGeofenceId(company)
    const filters = params.get('activeOnly') === 'true' ? [{ field: 'isActive', operator: '==', value: true }] : []
    const records = (await listAttendanceRecords(database, 'geofencelocations', filters, 1000)).filter(l => !company || l.scope === 'organisation' || !l.company || attendanceId(l.company) === company)
    records.sort((a,b) => Number(b.isPrimary)-Number(a.isPrimary) || new Date(b.createdAt)-new Date(a.createdAt))
    const data = await Promise.all(records.map(r => populateGeofenceRecord(database, r)))
    return NextResponse.json({ success: true, data, count: data.length })
  } catch(error) { return failure(error) }
}
export async function POST(request) {
  try {
    const { database, user } = await geofenceContext(request, true)
    const result = await saveGeofenceLocation(database, user, await request.json())
    return NextResponse.json({ success: true, message: 'Geofence location created successfully', data: await populateGeofenceRecord(database, result) })
  } catch(error) { return failure(error) }
}

