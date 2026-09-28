import { NextResponse } from 'next/server'
import { TrackSource } from 'livekit-server-sdk'
import { getAuthAndModels } from '@/lib/auth'
import { createLiveKitParticipantToken, getLiveKitConfig } from '@/lib/meetings/livekit.server'
import { remoteSupportEmployeeId, remoteSupportUserId } from '@/lib/remoteSupport.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fail(message, status) {
  return NextResponse.json({ success: false, message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request, context) {
  const auth = await getAuthAndModels(request, ['RemoteSupportSession', 'Employee'])
  if (!auth.success) return fail(auth.message || 'Unauthorized', 401)
  if (!getLiveKitConfig().configured) return fail('Managed screen sharing is not configured.', 503)
  const { id } = await context.params
  const session = await auth.models.RemoteSupportSession.findById(id).lean()
  const userId = remoteSupportUserId(auth.user)
  if (!session || ![String(session.targetUser), String(session.requestedByUser)].includes(userId)) return fail('Remote session not found.', 404)
  if (session.status !== 'approved' || new Date(session.expiresAt) <= new Date()) return fail('Screen sharing is available only during an employee-approved active session.', 409)
  const isTarget = String(session.targetUser) === userId
  const employeeId = remoteSupportEmployeeId(auth.user)
  const employee = employeeId ? await auth.models.Employee.findById(employeeId).select('firstName lastName').lean() : null
  const credentials = await createLiveKitParticipantToken({
    databaseName: auth.tenant.databaseName,
    roomId: session.roomId,
    identity: `remote_${userId}`,
    name: [employee?.firstName, employee?.lastName].filter(Boolean).join(' ') || (isTarget ? session.targetName : session.requestedByName),
    metadata: { type: 'remote-support', sessionId: String(session._id), side: isTarget ? 'employee' : 'administrator' },
    canPublish: isTarget,
    canPublishSources: isTarget ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : [],
    canPublishData: false,
  })
  return NextResponse.json({ success: true, data: credentials, session: { id: String(session._id), status: session.status, reason: session.reason } }, { headers: { 'Cache-Control': 'no-store' } })
}
