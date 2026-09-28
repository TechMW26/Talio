import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getAuthAndModels } from '@/lib/auth'
import {
  closeRemoteSupportRoom,
  isRemoteSupportAdministrator,
  publishRemoteSupportEvent,
  remoteSupportEmployeeId,
  remoteSupportPublicSession,
  remoteSupportUserId,
  REMOTE_SUPPORT_REQUEST_MINUTES,
} from '@/lib/remoteSupport.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fail(message, status) {
  return NextResponse.json({ success: false, message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request) {
  const auth = await getAuthAndModels(request, ['RemoteSupportSession'])
  if (!auth.success) return fail(auth.message || 'Unauthorized', 401)
  const userId = remoteSupportUserId(auth.user)
  if (!userId) return fail('A signed-in user is required.', 401)
  const expired = await auth.models.RemoteSupportSession.find({ status: { $in: ['pending', 'approved'] }, expiresAt: { $lte: new Date() } }).select('roomId').lean()
  if (expired.length) {
    await auth.models.RemoteSupportSession.updateMany(
      { status: { $in: ['pending', 'approved'] }, expiresAt: { $lte: new Date() } },
      { $set: { status: 'expired', endedAt: new Date() } },
    )
    await Promise.allSettled(expired.map(session => closeRemoteSupportRoom(auth.tenant.databaseName, session.roomId)))
  }
  const sessions = await auth.models.RemoteSupportSession.find({
    $or: [{ targetUser: userId }, { requestedByUser: userId }],
  }).sort({ requestedAt: -1 }).limit(20).lean()
  return NextResponse.json({ success: true, sessions: sessions.map(session => ({
    ...remoteSupportPublicSession(session),
    side: String(session.targetUser) === userId ? 'employee' : 'administrator',
  })) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request) {
  const auth = await getAuthAndModels(request, ['RemoteSupportSession', 'Employee', 'User'])
  if (!auth.success) return fail(auth.message || 'Unauthorized', 401)
  if (!isRemoteSupportAdministrator(auth.user)) return fail('Only an organization administrator can request a remote MIRA session.', 403)
  try {
    const body = await request.json()
    const employeeId = String(body.employeeId || '')
    const reason = String(body.reason || '').trim()
    if (!/^[a-f\d]{24}$/i.test(employeeId) || reason.length < 5 || reason.length > 500) {
      return fail('Choose an employee and provide a brief reason (5–500 characters).', 400)
    }
    const target = await auth.models.Employee.findOne({ _id: employeeId, status: 'active' }).select('_id firstName lastName').lean()
    if (!target) return fail('The employee is not active in this organization.', 404)
    const targetAccount = await auth.models.User.findOne({ employeeId: target._id, isActive: true }).select('_id').lean()
    if (!targetAccount) return fail('This employee has no active Talio account to receive the request.', 409)

    const requesterId = remoteSupportUserId(auth.user)
    const requesterEmployeeId = remoteSupportEmployeeId(auth.user)
    if (String(targetAccount._id) === requesterId) return fail('You cannot request remote access to your own device.', 400)
    const requester = requesterEmployeeId
      ? await auth.models.Employee.findById(requesterEmployeeId).select('firstName lastName').lean()
      : null
    const requestedByName = [requester?.firstName, requester?.lastName].filter(Boolean).join(' ') || 'Organization administrator'
    const targetName = [target.firstName, target.lastName].filter(Boolean).join(' ')
    const now = new Date()
    const existing = await auth.models.RemoteSupportSession.findOne({
      targetUser: targetAccount._id,
      status: { $in: ['pending', 'approved'] },
      expiresAt: { $gt: now },
    }).select('_id').lean()
    if (existing) return fail('This employee already has a pending or active remote-support session.', 409)
    const session = await auth.models.RemoteSupportSession.create({
      targetUser: targetAccount._id,
      targetEmployee: target._id,
      targetName,
      requestedByUser: requesterId,
      requestedByEmployee: requesterEmployeeId || null,
      requestedByName,
      reason,
      roomId: `support_${randomUUID().replace(/-/g, '')}`,
      status: 'pending',
      requestedAt: now,
      expiresAt: new Date(now.getTime() + REMOTE_SUPPORT_REQUEST_MINUTES * 60_000),
      audit: [{ event: 'requested', actor: requesterId, detail: reason, at: now }],
    })
    const data = remoteSupportPublicSession(session.toObject())
    await publishRemoteSupportEvent([targetAccount._id], 'remote-support-requested', { session: data })
    return NextResponse.json({ success: true, session: { ...data, side: 'administrator' } }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[Remote support] Request failed:', error)
    return fail('Could not request a remote MIRA session.', 500)
  }
}
