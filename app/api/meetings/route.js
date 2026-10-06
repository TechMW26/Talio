import { after, NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { resolveMeetingEmployee } from '@/lib/meetingParticipants'
import { getMeetingDatabase, listMeetings, createMeetingSeries, populateMeeting, meetingAccess } from '@/lib/meetings/store.server'
import { deliverMeetingInvitations } from '@/lib/meetings/delivery.server'
import { refreshMeetingAvailability } from '@/lib/meetings/meetingAvailability.server'
export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const database = await getMeetingDatabase(auth.tenant.databaseName), employee = await resolveMeetingEmployee(database, auth.user)
    if (!employee) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    const params = new URL(request.url).searchParams
    const { records, pagination } = await listMeetings(database, employee, params)
    const data = await Promise.all(records.map(async meeting => {
      if (params.get('view') === 'upcoming') {
        return Object.fromEntries(['_id', 'title', 'scheduledStart', 'scheduledEnd', 'status', 'priority', 'type'].map(key => [key, meeting[key]]))
      }
      if (meeting.type === 'online' && (!meeting.roomPresenceCheckedAt || Date.now() - new Date(meeting.roomPresenceCheckedAt) > 15000)) {
        try { meeting = await refreshMeetingAvailability(database, meeting, auth.tenant.databaseName) } catch {}
      }
      const access = meetingAccess(meeting, employee)
      return { ...await populateMeeting(database, meeting), isOrganizer: access.isOrganizer, myInviteStatus: access.invitation?.status || null }
    }))
    return NextResponse.json({ success: true, data, pagination })
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) }
}
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const database = await getMeetingDatabase(auth.tenant.databaseName), employee = await resolveMeetingEmployee(database, auth.user)
    if (!employee) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    const meetings = await createMeetingSeries(database, await request.json(), employee)
    after(() => deliverMeetingInvitations(database, meetings, employee))
    return NextResponse.json({ success: true, message: 'Meeting created successfully', data: await populateMeeting(database, meetings[0]), recurrence: meetings.length > 1 ? { occurrenceCount: meetings.length } : undefined }, { status: 201 })
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) }
}
