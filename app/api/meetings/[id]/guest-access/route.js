import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getAuthAndDatabase } from '@/lib/auth'
import { resolveMeetingEmployee } from '@/lib/meetingParticipants'
import { getMeetingDatabase, meetingAccess, meetingError } from '@/lib/meetings/store.server'
async function handle(request, { params }, write) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const database = await getMeetingDatabase(auth.tenant.databaseName), employee = await resolveMeetingEmployee(database, auth.user), { id } = await params
    const body = write ? await request.json() : {}
    if (write && typeof body.enabled !== 'boolean') throw meetingError('Guest access state must be true or false')
    const authorize = meeting => {
      if (!meeting) throw meetingError('Meeting not found', 404)
      if (!meetingAccess(meeting, employee).isOrganizer && !['admin', 'hr'].includes(auth.user.role)) throw meetingError('Only the meeting organizer can manage guest access', 403)
      if (write && meeting.type !== 'online') throw meetingError('Guest access is only available for online meetings')
    }
    let meeting = await database.get('meetings', id)
    authorize(meeting)
    if (write) meeting = await database.mutate('meetings', id, current => {
      authorize(current)
      const guestAccess = { ...current.guestAccess, enabled: body.enabled }
      if (body.enabled && !guestAccess.guestLink) Object.assign(guestAccess, { guestLink: `v2.${Buffer.from(auth.tenant.databaseName).toString('base64url')}.${randomUUID()}`, guestLinkCreatedAt: new Date(), tenantDatabase: auth.tenant.databaseName })
      return { ...current, guestAccess, updatedAt: new Date() }
    })
    const baseUrl = (process.env.NODE_ENV === 'production' ? process.env.NEXT_PUBLIC_APP_URL : '') || new URL(request.url).origin
    return NextResponse.json({ success: true, data: { guestAccessEnabled: Boolean(meeting.guestAccess?.enabled), guestLink: meeting.guestAccess?.guestLink || null, guestUrl: meeting.guestAccess?.enabled ? `${baseUrl.replace(/\/+$/, '')}/join/${meeting.guestAccess.guestLink}` : null, guests: meeting.guestAccess?.guests || [], canEnableGuestAccess: meeting.type === 'online' } })
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) }
}
export const GET = (request, context) => handle(request, context, false)
export const POST = (request, context) => handle(request, context, true)
