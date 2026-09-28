import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getAuthAndModels } from '@/lib/auth'
import { publishRemoteSupportEvent, remoteSupportPublicSession, remoteSupportUserId } from '@/lib/remoteSupport.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fail(message, status) {
  return NextResponse.json({ success: false, message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function authorizedSession(request, id) {
  const auth = await getAuthAndModels(request, ['RemoteSupportSession'])
  if (!auth.success) return { error: fail(auth.message || 'Unauthorized', 401) }
  const session = await auth.models.RemoteSupportSession.findById(id).lean()
  const userId = remoteSupportUserId(auth.user)
  if (!session || ![String(session.targetUser), String(session.requestedByUser)].includes(userId)) return { error: fail('Remote session not found.', 404) }
  if (session.status !== 'approved' || new Date(session.expiresAt) <= new Date()) return { error: fail('This remote session is not active.', 409) }
  return { auth, session, userId, isTarget: String(session.targetUser) === userId }
}

export async function GET(request, context) {
  const { id } = await context.params
  const result = await authorizedSession(request, id)
  if (result.error) return result.error
  if (!result.isTarget) return fail('Only the employee device may receive relayed commands.', 403)
  const now = new Date()
  const retryBefore = new Date(now.getTime() - 30_000)
  const candidates = (result.session.commands || []).filter(command => command.status === 'pending'
    || (command.status === 'delivered' && (!command.deliveredAt || new Date(command.deliveredAt) <= retryBefore)))
  const pending = []
  for (const command of candidates) {
    const wasPending = command.status === 'pending'
    const claimed = await result.auth.models.RemoteSupportSession.updateOne(
      {
        _id: id,
        targetUser: result.userId,
        status: 'approved',
        commands: { $elemMatch: wasPending
          ? { id: command.id, status: 'pending' }
          : { id: command.id, status: 'delivered', $or: [{ deliveredAt: null }, { deliveredAt: { $lte: retryBefore } }] } },
      },
      { $set: { 'commands.$.status': 'delivered', 'commands.$.deliveredAt': now } },
    )
    if (claimed.modifiedCount || claimed.nModified) pending.push({ id: command.id, text: command.text, createdAt: command.createdAt })
  }
  return NextResponse.json({ success: true, commands: pending }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request, context) {
  const { id } = await context.params
  const result = await authorizedSession(request, id)
  if (result.error) return result.error
  if (result.isTarget) return fail('Only the requesting administrator can relay commands.', 403)
  let body
  try { body = await request.json() } catch { return fail('Invalid request body.', 400) }
  const text = String(body.text || '').trim()
  if (!text || text.length > 2000) return fail('A command must be 1–2,000 characters.', 400)
  const now = new Date()
  const command = { id: randomUUID(), text, status: 'pending', createdAt: now }
  const updated = await result.auth.models.RemoteSupportSession.findOneAndUpdate(
    { _id: id, requestedByUser: result.userId, status: 'approved', expiresAt: { $gt: now } },
    { $push: { commands: command, audit: { event: 'command_sent', actor: result.userId, detail: 'Admin relayed a command to employee MIRA.', at: now } } },
    { new: true },
  ).lean()
  if (!updated) return fail('The remote session ended before the command could be sent.', 409)
  await publishRemoteSupportEvent([updated.targetUser], 'remote-support-command', { sessionId: String(updated._id), commandId: command.id })
  return NextResponse.json({ success: true, command: { id: command.id, text, status: 'pending', createdAt: now } }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(request, context) {
  const { id } = await context.params
  const result = await authorizedSession(request, id)
  if (result.error) return result.error
  if (!result.isTarget) return fail('Only the employee device can report command results.', 403)
  let body
  try { body = await request.json() } catch { return fail('Invalid request body.', 400) }
  const commandId = String(body.commandId || '')
  const status = ['running', 'completed', 'failed'].includes(body.status) ? body.status : ''
  const message = String(body.result || '').trim().slice(0, 4000)
  if (!commandId || !status) return fail('A command ID and valid result status are required.', 400)
  const now = new Date()
  const updated = await result.auth.models.RemoteSupportSession.findOneAndUpdate(
    { _id: id, targetUser: result.userId, status: 'approved', commands: { $elemMatch: { id: commandId, status: { $in: ['pending', 'delivered', 'running'] } } } },
    {
      $set: { 'commands.$.status': status, ...(status === 'running' ? {} : { 'commands.$.result': message, 'commands.$.completedAt': now }) },
      ...(status === 'running' ? {} : { $push: { audit: { event: status === 'completed' ? 'command_completed' : 'command_failed', actor: result.userId, detail: message.slice(0, 500), at: now } } }),
    },
    { new: true },
  ).lean()
  if (!updated) return fail('Command result was not saved; the command may already be complete or the session ended.', 409)
  await publishRemoteSupportEvent([updated.requestedByUser], 'remote-support-command-result', { session: remoteSupportPublicSession(updated) })
  return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } })
}
