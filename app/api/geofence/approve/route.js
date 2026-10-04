import { NextResponse } from 'next/server'
import { geofenceContext } from '@/lib/platform/firestoreGeofence.server'
import { attendanceId, attendanceError } from '@/lib/platform/firestoreAttendance.server'
import { sendPushToUser } from '@/lib/pushNotification'
export async function POST(request) {
  try {
    const { database, user } = await geofenceContext(request)
    const { logId, action, comments } = await request.json()
    if (!/^[a-f0-9]{24}$/.test(logId || '') || !['approved', 'rejected'].includes(action) || (comments && typeof comments !== 'string')) throw attendanceError('Valid log ID and approval action required')
    const result = await database.transaction(async tx => {
      const [log, account] = await Promise.all([tx.get('geofencelogs', logId), tx.get('users', attendanceId(user._id || user.userId))])
      const reviewer = account?.employeeId ? await tx.get('employees', attendanceId(account.employeeId)) : null
      if (!log) throw attendanceError('Geofence log not found', 404)
      if (!reviewer) throw attendanceError('Reviewer employee not found', 404)
      if (log.outOfPremisesRequest?.status !== 'pending') throw attendanceError('This request has already been reviewed', 409)
      const allowed = ['admin', 'hr'].includes(account.role) || (account.role === 'department_head' && attendanceId(reviewer.department) === attendanceId(log.department)) || (account.role === 'manager' && attendanceId(log.reportingManager) === reviewer._id)
      if (!allowed) throw attendanceError('You do not have permission to review this request', 403)
      const next = { ...log, outOfPremisesRequest: { ...log.outOfPremisesRequest, status: action, reviewedBy: reviewer._id, reviewedAt: new Date(), reviewerComments: String(comments || '').slice(0, 10000) }, updatedAt: new Date() }
      await tx.replace('geofencelogs', next)
      return { log: next, reviewer }
    })
    if (result.log.user && process.env.TALIO_LOCAL_ACCEPTANCE !== '1') await sendPushToUser(attendanceId(result.log.user), { title: 'Out-of-Premises Request ' + action, body: 'Your request has been ' + action + ' by ' + result.reviewer.firstName + ' ' + result.reviewer.lastName }, { database, eventType: 'geofenceApproval', clickAction: '/dashboard/team/geofencing', data: { type: 'geofence_approval', logId, action } }).catch(() => {})
    return NextResponse.json({ success: true, message: 'Request ' + action + ' successfully', data: result.log })
  } catch(error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) }
}

