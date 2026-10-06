import { after, NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { resolveMeetingEmployee } from '@/lib/meetingParticipants'
import { sortMeetingTranscript } from '@/lib/meetingLanguage'
import { getMeetingDatabase, requireMeeting, updateMeeting, populateMeeting, meetingAccess } from '@/lib/meetings/store.server'
import { refreshMeetingAvailability } from '@/lib/meetings/meetingAvailability.server'
import { deliverMeetingInvitations, deliverMeetingChange } from '@/lib/meetings/delivery.server'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
async function handle(request, context, method) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const database = await getMeetingDatabase(auth.tenant.databaseName), employee = await resolveMeetingEmployee(database, auth.user), { id } = await context.params
    let meeting = await requireMeeting(database, id, employee, method !== 'GET')
    if (method === 'GET') {
      if (meeting.type === 'online' && (!meeting.roomPresenceCheckedAt || Date.now() - new Date(meeting.roomPresenceCheckedAt) > 15000)) try { meeting = await refreshMeetingAvailability(database, meeting, auth.tenant.databaseName) } catch {}
      const data = await populateMeeting(database, meeting), access = meetingAccess(meeting, employee)
      return NextResponse.json({ success: true, data: { ...data, transcript: sortMeetingTranscript(data.transcript), isOrganizer: access.isOrganizer, myInviteStatus: access.invitation?.status || null } })
    }
    if (method === 'PUT') {
      const body = await request.json()
      if (meeting.type === 'online' && body.status === 'completed') {
        meeting = await refreshMeetingAvailability(database, meeting, auth.tenant.databaseName)
        if (meeting.status !== 'completed') return NextResponse.json({ success: false, message: 'The meeting is occupied or still within its 10-minute rejoin window.' }, { status: 409 })
      }
      const updated = await updateMeeting(database, id, employee, body)
      after(async () => {
        if (body.addInvitees?.length) await deliverMeetingInvitations(database, [{ ...updated, invitees: updated.invitees.filter(row => body.addInvitees.includes(String(row.employee))) }], employee)
        if (['title', 'description', 'scheduledStart', 'scheduledEnd', 'location', 'priority'].some(key => body[key] !== undefined)) await deliverMeetingChange(database, updated, 'updated', updated.title)
      })
      return NextResponse.json({ success: true, message: 'Meeting updated successfully', data: await populateMeeting(database, updated) })
    }
    const params = new URL(request.url).searchParams, permanent = params.get('permanent') === 'true', reason = params.get('reason') || 'Meeting cancelled'
    await database.transaction(async tx => {
      const current = await requireMeeting(tx, id, employee, true)
      if (permanent) await tx.delete('meetings', id)
      else await tx.replace('meetings', { ...current, status: 'cancelled', isLinkActive: false, cancelledBy: employee._id, cancellationReason: reason, cancelledAt: new Date(), updatedAt: new Date() })
    })
    after(() => deliverMeetingChange(database, meeting, permanent ? 'deleted' : 'cancelled', reason))
    return NextResponse.json({ success: true, message: permanent ? 'Meeting deleted successfully' : 'Meeting cancelled successfully' })
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || (error.name === 'MeetingUpdateValidationError' ? 400 : 500) }) }
}
export const GET = (request, context) => handle(request, context, 'GET')
export const PUT = (request, context) => handle(request, context, 'PUT')
export const DELETE = (request, context) => handle(request, context, 'DELETE')
