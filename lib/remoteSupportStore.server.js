import { randomBytes, randomUUID } from 'node:crypto'
import { isRemoteSupportAdministrator, REMOTE_SUPPORT_MAX_MINUTES, REMOTE_SUPPORT_REQUEST_MINUTES } from './remoteSupport.server'

export const REMOTE_SUPPORT_STORE_OPTIONS = { queryFields: { remotesupportsessions: ['targetUser', 'requestedByUser', 'status', 'expiresAt', 'requestedAt'], users: ['employeeId', 'isActive'] } }
const idOf = value => String(value?._id || value || '')
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const assertId = id => { if (!/^[a-f\d]{24}$/i.test(String(id))) fail('Invalid remote session') }
export async function supportAccount(reader, actor) {
  const account = await reader.get('users', idOf(actor._id || actor.userId))
  if (!account?.isActive) fail('Account is not active', 403)
  return account
}
export async function supportSession(reader, actor, id, active = true) {
  assertId(id)
  const account = await supportAccount(reader, actor), session = await reader.get('remotesupportsessions', id)
  if (!session || ![session.targetUser, session.requestedByUser].map(idOf).includes(account._id)) fail('Remote session not found', 404)
  const isTarget = idOf(session.targetUser) === account._id
  if (active) {
    const [requester, target] = await Promise.all([reader.get('users', idOf(session.requestedByUser)), reader.get('users', idOf(session.targetUser))])
    if (!requester?.isActive || !isRemoteSupportAdministrator(requester) || !target?.isActive) fail('Participant access has been revoked', 403)
    if (session.status !== 'approved' || new Date(session.expiresAt) <= new Date()) fail('An employee-approved active session is required', 409)
  }
  return { account, session, isTarget }
}
export async function createSupportSession(database, actor, input) {
  assertId(input.employeeId)
  const reason = String(input.reason || '').trim()
  if (reason.length < 5 || reason.length > 500) fail('Provide a brief reason (5–500 characters)')
  const id = randomBytes(12).toString('hex'), roomId = `support_${randomUUID().replace(/-/g, '')}`
  return database.transaction(async tx => {
    const account = await supportAccount(tx, actor)
    if (!isRemoteSupportAdministrator(account)) fail('Only an organization administrator can request remote support', 403)
    const target = await tx.get('employees', input.employeeId)
    if (target?.status !== 'active') fail('The employee is not active in this organization', 404)
    const users = (await tx.list('users', { filters: [{ field: 'employeeId', operator: '==', value: target._id }, { field: 'isActive', operator: '==', value: true }], limit: 2 })).records
    if (users.length !== 1) fail('The employee must have exactly one active account', 409)
    if (users[0]._id === account._id) fail('You cannot request remote access to your own device')
    const requester = account.employeeId ? await tx.get('employees', idOf(account.employeeId)) : null
    const guard = await tx.get('remotesupportguards', target._id)
    const now = new Date()
    const active = await tx.list('remotesupportsessions', { filters: [{ field: 'targetUser', operator: '==', value: users[0]._id }, { field: 'status', operator: 'in', value: ['pending', 'approved'] }, { field: 'expiresAt', operator: '>', value: now }], limit: 1 })
    if (active.records.length) fail('This employee already has a pending or active session', 409)
    const name = e => [e?.firstName, e?.lastName].filter(Boolean).join(' ')
    const session = { _id: id, targetUser: users[0]._id, targetEmployee: target._id, targetName: name(target), requestedByUser: account._id, requestedByEmployee: idOf(account.employeeId) || null, requestedByName: name(requester) || 'Organization administrator', reason, roomId, status: 'pending', requestedAt: now, expiresAt: new Date(now.getTime() + REMOTE_SUPPORT_REQUEST_MINUTES * 60000), commands: [], audit: [{ event: 'requested', actor: account._id, detail: reason, at: now }], createdAt: now, updatedAt: now }
    const nextGuard = { _id: target._id, sessionId: id, revision: Number(guard?.revision || 0) + 1 }
    if (guard) await tx.replace('remotesupportguards', nextGuard); else await tx.create('remotesupportguards', nextGuard)
    await tx.create('remotesupportsessions', session)
    return session
  })
}
export async function transitionSupport(database, actor, id, action) {
  if (!['approve', 'decline', 'end'].includes(action)) fail('Choose approve, decline, or end')
  return database.transaction(async tx => {
    const { account, session, isTarget } = await supportSession(tx, actor, id, false)
    const now = new Date(), next = { ...session, updatedAt: now }
    if (!['pending', 'approved'].includes(session.status)) fail('This session has already ended', 409)
    if (action !== 'end') {
      if (!isTarget) fail('Only the employee can approve or decline', 403)
      if (session.status !== 'pending' || new Date(session.expiresAt) <= now) fail('This request is no longer pending', 409)
      const requester = await tx.get('users', idOf(session.requestedByUser))
      if (!requester?.isActive || !isRemoteSupportAdministrator(requester)) fail('Administrator access was revoked', 403)
      next.status = action === 'approve' ? 'approved' : 'declined'
      next.decidedAt = now
      if (action === 'approve') next.expiresAt = new Date(now.getTime() + REMOTE_SUPPORT_MAX_MINUTES * 60000)
      else next.endedAt = now
    } else { next.status = 'ended'; next.endedAt = now }
    next.audit = [...(session.audit || []), { event: next.status, actor: account._id, detail: action === 'approve' ? 'Employee approved screen sharing and MIRA command relay.' : 'Session response from a participant.', at: now }]
    await tx.replace('remotesupportsessions', next)
    return { session: next, isTarget }
  })
}
export async function supportCommands(database, actor, id, method, input = {}) {
  const commandId = randomUUID()
  return database.transaction(async tx => {
    const { account, session, isTarget } = await supportSession(tx, actor, id)
    if ((method === 'POST' && isTarget) || (method !== 'POST' && !isTarget)) fail('This operation is not available to this participant', 403)
    const now = new Date(), next = { ...session, commands: [...(session.commands || [])], audit: [...(session.audit || [])], updatedAt: now }
    let result
    if (method === 'POST') {
      const text = String(input.text || '').trim()
      if (!text || text.length > 2000) fail('A command must be 1–2,000 characters')
      if (next.commands.length >= 200) fail('This session has reached its command limit', 409)
      result = { id: commandId, text, status: 'pending', createdAt: now }
      next.commands.push(result)
      next.audit.push({ event: 'command_sent', actor: account._id, detail: 'Admin relayed a command to employee MIRA.', at: now })
    } else if (method === 'GET') {
      result = []
      next.commands = next.commands.map(command => {
        if (command.status !== 'pending' && !(command.status === 'delivered' && (!command.deliveredAt || new Date(command.deliveredAt).getTime() <= now.getTime() - 30000))) return command
        result.push({ id: command.id, text: command.text, createdAt: command.createdAt })
        return { ...command, status: 'delivered', deliveredAt: now }
      })
    } else {
      if (!['running', 'completed', 'failed'].includes(input.status)) fail('Invalid command status')
      const index = next.commands.findIndex(command => command.id === input.commandId)
      if (index < 0 || !['delivered', 'running'].includes(next.commands[index].status)) fail('Command is not available for completion', 409)
      next.commands[index] = { ...next.commands[index], status: input.status, ...(input.status !== 'running' ? { result: String(input.result || '').slice(0, 4000), completedAt: now } : {}) }
      if (input.status !== 'running') next.audit.push({ event: `command_${input.status}`, actor: account._id, detail: String(input.result || '').slice(0, 500), at: now })
    }
    await tx.replace('remotesupportsessions', next)
    return { session: next, result }
  })
}
