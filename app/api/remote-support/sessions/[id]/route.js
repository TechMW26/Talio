import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { closeRemoteSupportRoom, publishRemoteSupportEvent, remoteSupportPublicSession, remoteSupportUserId, REMOTE_SUPPORT_MAX_MINUTES } from '@/lib/remoteSupport.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fail(message, status) {
  return NextResponse.json({ success: false, message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(request, context) {
  const auth = await getAuthAndModels(request, ['RemoteSupportSession'])
  if (!auth.success) return fail(auth.message || 'Unauthorized', 401)
  const userId = remoteSupportUserId(auth.user)
  const { id } = await context.params
  if (!/^[a-f\d]{24}$/i.test(String(id || ''))) return fail('Invalid remote session.', 400)
  let body
  try { body = await request.json() } catch { return fail('Invalid request body.', 400) }
  const action = String(body.action || '')
  if (!['approve', 'decline', 'end'].includes(action)) return fail('Choose approve, decline, or end.', 400)

  const session = await auth.models.RemoteSupportSession.findById(id).lean()
  if (!session || ![String(session.targetUser), String(session.requestedByUser)].includes(userId)) return fail('Remote session not found.', 404)
  const isTarget = String(session.targetUser) === userId
  const now = new Date()
  let filter = { _id: id, status: session.status }
  let update
  if (action === 'approve' || action === 'decline') {
    if (!isTarget) return fail('Only the employee can approve or decline this request.', 403)
    if (session.status !== 'pending' || new Date(session.expiresAt) <= now) return fail('This request is no longer pending. Ask the administrator to create a new request.', 409)
    filter = { _id: id, targetUser: userId, status: 'pending', expiresAt: { $gt: now } }
    update = action === 'approve'
      ? { $set: { status: 'approved', decidedAt: now, expiresAt: new Date(now.getTime() + REMOTE_SUPPORT_MAX_MINUTES * 60_000) }, $push: { audit: { event: 'approved', actor: userId, detail: 'Employee approved screen sharing and MIRA command relay.', at: now } } }
      : { $set: { status: 'declined', decidedAt: now, endedAt: now }, $push: { audit: { event: 'declined', actor: userId, detail: 'Employee declined the request.', at: now } } }
  } else {
    if (session.status !== 'pending' && session.status !== 'approved') return fail('This remote session has already ended.', 409)
    filter = { _id: id, status: { $in: ['pending', 'approved'] }, $or: [{ targetUser: userId }, { requestedByUser: userId }] }
    update = { $set: { status: 'ended', endedAt: now }, $push: { audit: { event: 'ended', actor: userId, detail: 'Session stopped by a participant.', at: now } } }
  }

  const updated = await auth.models.RemoteSupportSession.findOneAndUpdate(filter, update, { new: true }).lean()
  if (!updated) return fail('The session changed before this action completed. Refresh and try again.', 409)
  const data = remoteSupportPublicSession(updated)
  if (updated.status === 'ended') await closeRemoteSupportRoom(auth.tenant.databaseName, updated.roomId)
  await publishRemoteSupportEvent([updated.targetUser, updated.requestedByUser], `remote-support-${updated.status}`, { session: data })
  return NextResponse.json({ success: true, session: { ...data, side: isTarget ? 'employee' : 'administrator' } }, { headers: { 'Cache-Control': 'no-store' } })
}
