import { NextResponse } from 'next/server'
import { TrackSource } from 'livekit-server-sdk'
import { getAuthAndDatabase } from './auth'
import { createLiveKitParticipantToken, getLiveKitConfig } from './meetings/livekit.server'
import { closeRemoteSupportRoom, publishRemoteSupportEvent, remoteSupportPublicSession } from './remoteSupport.server'
import { REMOTE_SUPPORT_STORE_OPTIONS, createSupportSession, supportAccount, supportCommands, supportSession, transitionSupport } from './remoteSupportStore.server'

const headers = { 'Cache-Control': 'no-store' }
const response = (body, status = 200) => NextResponse.json(body, { status, headers })
export async function handleRemoteSupport(request, context = {}, kind = 'sessions') {
  try {
    const auth = await getAuthAndDatabase(request, REMOTE_SUPPORT_STORE_OPTIONS)
    if (!auth.success) return response({ success: false, message: auth.message }, auth.status || 401)
    const { database, user, tenant } = auth, params = await context.params || {}
    if (kind === 'sessions' && request.method === 'GET') {
      const account = await supportAccount(database, user)
      const pages = await Promise.all(['targetUser', 'requestedByUser'].map(field => database.list('remotesupportsessions', { filters: [{ field, operator: '==', value: account._id }], orderBy: [{ field: 'requestedAt', direction: 'desc' }], limit: 20 })))
      const sessions = [...new Map(pages.flatMap(page => page.records).map(session => [session._id, session])).values()].sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt)).slice(0, 20)
      return response({ success: true, sessions: sessions.map(session => ({ ...remoteSupportPublicSession(session), status: ['pending', 'approved'].includes(session.status) && new Date(session.expiresAt) <= new Date() ? 'expired' : session.status, side: session.targetUser === account._id ? 'employee' : 'administrator' })) })
    }
    if (kind === 'sessions') {
      const session = await createSupportSession(database, user, await request.json())
      const data = remoteSupportPublicSession(session)
      await publishRemoteSupportEvent([session.targetUser], 'remote-support-requested', { session: data }, tenant.databaseName).catch(() => {})
      return response({ success: true, session: { ...data, side: 'administrator' } }, 201)
    }
    if (kind === 'session') {
      const { session, isTarget } = await transitionSupport(database, user, params.id, (await request.json()).action)
      if (session.status === 'ended' && process.env.TALIO_LOCAL_ACCEPTANCE !== '1') await closeRemoteSupportRoom(tenant.databaseName, session.roomId)
      const data = remoteSupportPublicSession(session)
      await publishRemoteSupportEvent([session.targetUser, session.requestedByUser], `remote-support-${session.status}`, { session: data }, tenant.databaseName).catch(() => {})
      return response({ success: true, session: { ...data, side: isTarget ? 'employee' : 'administrator' } })
    }
    if (kind === 'token') {
      const { account, session, isTarget } = await supportSession(database, user, params.id)
      if (!getLiveKitConfig().configured) return response({ success: false, message: 'Managed screen sharing is not configured' }, 503)
      const employee = account.employeeId ? await database.get('employees', String(account.employeeId)) : null
      const data = await createLiveKitParticipantToken({ databaseName: tenant.databaseName, roomId: session.roomId, identity: `remote_${account._id}`, name: [employee?.firstName, employee?.lastName].filter(Boolean).join(' ') || (isTarget ? session.targetName : session.requestedByName), metadata: { type: 'remote-support', sessionId: session._id, side: isTarget ? 'employee' : 'administrator' }, canPublish: isTarget, canPublishSources: isTarget ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : [], canPublishData: false, ttl: Math.max(1, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000)) })
      return response({ success: true, data, session: { id: session._id, status: session.status, reason: session.reason } })
    }
    const { session, result } = await supportCommands(database, user, params.id, request.method, request.method === 'GET' ? {} : await request.json())
    if (request.method === 'GET') return response({ success: true, commands: result })
    const sent = request.method === 'POST'
    await publishRemoteSupportEvent([sent ? session.targetUser : session.requestedByUser], sent ? 'remote-support-command' : 'remote-support-command-result', sent ? { sessionId: session._id, commandId: result.id } : { session: remoteSupportPublicSession(session) }, tenant.databaseName).catch(() => {})
    return response({ success: true, ...(sent ? { command: result } : {}) }, sent ? 201 : 200)
  } catch (error) { return response({ success: false, message: error.status ? error.message : 'Unable to process remote support request' }, error.status || 500) }
}
