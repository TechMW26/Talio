import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'
import { findGuestMeeting } from '@/lib/meetings/guest.server'
import { refreshMeetingAvailability } from '@/lib/meetings/meetingAvailability.server'
import { meetingError } from '@/lib/meetings/store.server'
async function handle(request, { params }, join) {
  try {
    const { guestLink } = await params, found = await findGuestMeeting(guestLink)
    if (!found) throw meetingError('Invalid or expired guest link', 404)
    const { database, databaseName } = found
    let meeting = found.meeting
    if (meeting.type !== 'online') throw meetingError('Guest access is only available for online meetings')
    try { meeting = await refreshMeetingAvailability(database, meeting, databaseName) } catch { throw meetingError('Meeting presence could not be checked. Please retry.', 503) }
    if (meeting.isLinkActive === false || ['completed', 'cancelled'].includes(meeting.status)) throw meetingError('This meeting has ended', 410)
    if (!join) return NextResponse.json({ success: true, data: { title: meeting.title, description: meeting.description, scheduledStart: meeting.scheduledStart, scheduledEnd: meeting.scheduledEnd, roomId: meeting.roomId, requireApproval: Boolean(meeting.guestAccess?.requireApproval) } })
    const body = await request.json(), guestName = typeof body.guestName === 'string' ? body.guestName.trim() : ''
    if (guestName.length < 2 || guestName.length > 80) throw meetingError('Please enter a name between 2 and 80 characters')
    if (!process.env.JWT_SECRET) throw new Error('Guest sessions are not configured')
    const guestId = `guest_${randomUUID()}`
    await database.mutate('meetings', meeting._id, current => {
      if (!current?.guestAccess?.enabled || current.guestAccess.guestLink !== guestLink || current.isLinkActive === false || ['completed', 'cancelled'].includes(current.status)) throw meetingError('Guest access is no longer available', 410)
      if ((current.guestAccess.guests || []).length >= 1000) throw meetingError('Guest capacity reached', 409)
      return { ...current, guestAccess: { ...current.guestAccess, guests: [...(current.guestAccess.guests || []), { guestId, name: guestName, joinedAt: new Date() }] } }
    })
    const guestToken = await new SignJWT({ type: 'meeting_guest', roomId: meeting.roomId, guestId, guestName, tenantDatabaseName: databaseName }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + 14400).sign(new TextEncoder().encode(process.env.JWT_SECRET))
    return NextResponse.json({ success: true, data: { roomId: meeting.roomId, guestName, guestId, guestToken, meetingTitle: meeting.title } })
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) }
}
export const GET = (request, context) => handle(request, context, false)
export const POST = (request, context) => handle(request, context, true)
