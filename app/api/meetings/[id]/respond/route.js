import { after, NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { resolveMeetingEmployee } from '@/lib/meetingParticipants'
import { getMeetingDatabase, respondToMeeting } from '@/lib/meetings/store.server'
import { deliverMeetingResponse } from '@/lib/meetings/delivery.server'
export const dynamic = 'force-dynamic'
export async function POST(request, { params }) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const database = await getMeetingDatabase(auth.tenant.databaseName), employee = await resolveMeetingEmployee(database, auth.user), { id } = await params, body = await request.json()
    if (!employee) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    const meeting = await respondToMeeting(database, id, employee, String(auth.user._id || auth.user.userId), body.response || body.status, body.reason)
    const invitation = meeting.invitees.find(row => String(row.employee) === employee._id)
    after(() => deliverMeetingResponse(database, meeting, employee, invitation.status, body.reason))
    return NextResponse.json({ success: true, message: `Meeting invitation ${invitation.status}`, data: { status: invitation.status, respondedAt: invitation.respondedAt } })
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) }
}
