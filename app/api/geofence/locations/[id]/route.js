import { NextResponse } from 'next/server'
import { geofenceContext, assertGeofenceId, saveGeofenceLocation, populateGeofenceRecord } from '@/lib/platform/firestoreGeofence.server'
import { attendanceError } from '@/lib/platform/firestoreAttendance.server'
const failure = error => NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 })
export async function GET(request, { params }) {
  try {
    const { database } = await geofenceContext(request), { id } = await params
    assertGeofenceId(id)
    const record = await database.get('geofencelocations', id)
    if (!record) throw attendanceError('Location not found', 404)
    return NextResponse.json({ success: true, data: await populateGeofenceRecord(database, record) })
  } catch(error) { return failure(error) }
}
export async function PUT(request, { params }) {
  try {
    const { database, user } = await geofenceContext(request, true), { id } = await params
    const record = await saveGeofenceLocation(database, user, await request.json(), id)
    return NextResponse.json({ success: true, message: 'Geofence location updated successfully', data: await populateGeofenceRecord(database, record) })
  } catch(error) { return failure(error) }
}
export async function DELETE(request, { params }) {
  try {
    const { database } = await geofenceContext(request, true), { id } = await params
    assertGeofenceId(id)
    const record = await database.mutate('geofencelocations', id, current => {
      if (current.isPrimary) throw attendanceError('Cannot delete primary location. Set another location as primary first.')
      return { ...current, isActive: false, updatedAt: new Date() }
    })
    if (!record) throw attendanceError('Location not found', 404)
    return NextResponse.json({ success: true, message: 'Geofence location deleted successfully' })
  } catch(error) { return failure(error) }
}

