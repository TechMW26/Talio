import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { getAuthAndModels } from '@/lib/auth'
import { getTenantModel } from '@/lib/tenantModels'
import { checkTenantFeatureAccess } from '@/lib/companyFeatures.server'
import { createLiveKitParticipantToken, getLiveKitConfig } from '@/lib/meetings/livekit.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function error(message, status, code) {
  return NextResponse.json({ success: false, message, code }, { status })
}

async function readGuestSession(request) {
  const authorization = request.headers.get('authorization') || ''
  const token = authorization.startsWith('Guest ') ? authorization.slice(6) : null
  if (!token || !process.env.JWT_SECRET) return null
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET))
    return payload.type === 'meeting_guest' ? payload : null
  } catch {
    return null
  }
}

async function issueGuestToken(request, body, guest) {
  if (guest.roomId !== body.roomId || !guest.tenantDatabaseName || !guest.guestId) {
    return error('Guest session does not match this meeting', 403, 'GUEST_SESSION_MISMATCH')
  }
  const Meeting = await getTenantModel(guest.tenantDatabaseName, 'Meeting')
  const meeting = await Meeting.findOne({
    roomId: body.roomId,
    type: 'online',
    isLinkActive: true,
    'guestAccess.enabled': true,
  }).select('_id roomId scheduledEnd status').lean()
  if (!meeting) return error('Meeting guest access is unavailable', 404, 'MEETING_NOT_FOUND')
  if (new Date(meeting.scheduledEnd) < new Date() && meeting.status !== 'in-progress') {
    return error('This meeting has ended', 410, 'MEETING_ENDED')
  }
  const credentials = await createLiveKitParticipantToken({
    databaseName: guest.tenantDatabaseName,
    roomId: meeting.roomId,
    identity: guest.guestId,
    name: guest.guestName,
    metadata: { type: 'guest', guestId: guest.guestId },
  })
  return NextResponse.json({ success: true, data: credentials })
}

export async function POST(request) {
  try {
    if (!getLiveKitConfig().configured) {
      return error('Managed meeting media is not configured', 503, 'LIVEKIT_NOT_CONFIGURED')
    }
    const body = await request.json()
    const roomId = String(body.roomId || '').trim()
    if (!roomId) return error('Meeting room ID is required', 400, 'VALIDATION_ERROR')

    const guest = await readGuestSession(request)
    if (guest) return issueGuestToken(request, body, guest)

    const auth = await getAuthAndModels(request, ['Meeting', 'Employee'])
    if (!auth.success) return error(auth.message || 'Unauthorized', 401, 'UNAUTHORIZED')
    const featureAccess = await checkTenantFeatureAccess(auth, { allOf: ['meetings'] })
    if (!featureAccess.success) return error(featureAccess.message, featureAccess.status, featureAccess.code)

    const meeting = await auth.models.Meeting.findOne({ roomId, type: 'online', isLinkActive: true })
      .select('_id roomId organizer invitees scheduledEnd status')
      .lean()
    if (!meeting) return error('Meeting not found', 404, 'MEETING_NOT_FOUND')
    if (new Date(meeting.scheduledEnd) < new Date() && meeting.status !== 'in-progress') {
      return error('This meeting has ended', 410, 'MEETING_ENDED')
    }

    const employeeId = String(auth.user.employeeId || '')
    const invited = meeting.invitees?.some((invitee) => String(invitee.employee) === employeeId)
    const organizer = String(meeting.organizer) === employeeId
    if (!organizer && !invited && !['admin', 'hr'].includes(auth.user.role)) {
      return error('You are not invited to this meeting', 403, 'NOT_INVITED')
    }

    const employee = auth.user.employeeId
      ? await auth.models.Employee.findById(auth.user.employeeId).select('firstName lastName').lean()
      : null
    const displayName = [employee?.firstName, employee?.lastName].filter(Boolean).join(' ') || auth.user.email
    const credentials = await createLiveKitParticipantToken({
      databaseName: auth.tenant.databaseName,
      roomId: meeting.roomId,
      identity: `user_${auth.user.id || auth.user._id}`,
      name: displayName,
      metadata: { type: 'employee', userId: String(auth.user.id || auth.user._id), employeeId },
    })
    return NextResponse.json({ success: true, data: credentials })
  } catch (cause) {
    console.error('[LiveKit token] Failed:', cause)
    return error('Failed to create meeting media session', 500, 'TOKEN_ERROR')
  }
}
