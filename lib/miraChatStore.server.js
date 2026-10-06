import { createHash, randomBytes } from 'node:crypto'
import { recordDigest } from './platform/firestoreCodec.cjs'

export const MIRA_CHAT_STORE_OPTIONS = {
  queryFields: { mirachatsessions: ['user', 'lastMessageAt'], miratokenusages: ['user', 'month'] },
  constraints: { miratokenusages: [{ fields: ['user', 'month'] }] },
}
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const idOf = value => String(value?._id || value || '')
export const miraMonth = () => new Date().toISOString().slice(0, 7)
const usageFilters = (userId, month) => [{ field: 'user', operator: '==', value: userId }, { field: 'month', operator: '==', value: month }]
const tokens = usage => {
  const tokensUsed = Number(usage?.tokensUsed ?? 0), tokenLimit = Number(usage?.tokenLimit ?? 100)
  if (![tokensUsed, tokenLimit].every(n => Number.isSafeInteger(n) && n >= 0)) fail('Token balance requires reconciliation', 409)
  return { tokensUsed, tokenLimit, tokensRemaining: Math.max(0, tokenLimit - tokensUsed) }
}
export async function readMiraTokens(database, userId, month = miraMonth()) {
  const rows = (await database.list('miratokenusages', { filters: usageFilters(userId, month), limit: 2 })).records
  if (rows.length > 1) fail('Token balance requires reconciliation', 409)
  return tokens(rows[0])
}
export async function checkAndDeductMiraToken(database, userId, month = miraMonth()) {
  return database.transaction(async tx => {
    const user = await tx.get('users', userId)
    if (!user?.isActive) fail('Account is not active', 403)
    const rows = (await tx.list('miratokenusages', { filters: usageFilters(userId, month), limit: 2 })).records
    if (rows.length > 1) fail('Token balance requires reconciliation', 409)
    const current = rows[0], balance = tokens(current)
    if (!balance.tokensRemaining) return { ...balance, allowed: false }
    const now = new Date(), next = { ...current, _id: current?._id || createHash('sha256').update(`${userId}:${month}`).digest('hex').slice(0, 24), user: userId, month, tokensUsed: balance.tokensUsed + 1, tokenLimit: balance.tokenLimit, createdAt: current?.createdAt || now, updatedAt: now }
    if (current) await tx.replace('miratokenusages', next); else await tx.create('miratokenusages', next)
    return { ...tokens(next), allowed: true }
  })
}
export const miraSessionSummary = session => Object.fromEntries(['_id', 'title', 'lastMessageAt', 'createdAt', 'updatedAt'].map(key => [key, session[key]]))
export async function readMiraSession(database, userId, id) {
  if (!/^[a-f\d]{24}$/i.test(String(id))) fail('Invalid session ID')
  const session = await database.get('mirachatsessions', id)
  if (!session || idOf(session.user) !== userId) fail('Session not found', 404)
  return session
}
function title(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail('Title must be 1–200 characters')
  return value.trim()
}
export async function createMiraSession(database, userId, input) {
  const now = new Date()
  return database.create('mirachatsessions', { _id: randomBytes(12).toString('hex'), user: userId, title: input.title ? title(input.title) : 'New Chat', messages: [], lastMessageAt: now, createdAt: now, updatedAt: now })
}
export async function updateMiraSession(database, userId, id, input, remove = false) {
  const expectedDigest = input.replaceFromIndex !== undefined ? recordDigest(await readMiraSession(database, userId, id)) : null
  let messages
  if (input.messages !== undefined) {
    if (!Array.isArray(input.messages) || input.messages.length > 30) fail('Invalid conversation messages')
    messages = input.messages.map(message => {
      if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 100000) fail('Invalid conversation message')
      if (message.data !== undefined && JSON.stringify(message.data).length > 250000) fail('Message data is too large')
      const timestamp = message.timestamp ? new Date(message.timestamp) : new Date()
      if (!Number.isFinite(timestamp.getTime())) fail('Invalid message timestamp')
      return { _id: randomBytes(12).toString('hex'), role: message.role, content: message.content, ...(message.data !== undefined ? { data: message.data } : {}), timestamp }
    })
  }
  return database.transaction(async tx => {
    const user = await tx.get('users', userId)
    if (!user?.isActive) fail('Account is not active', 403)
    const session = await readMiraSession(tx, userId, id)
    if (expectedDigest && recordDigest(session) !== expectedDigest) fail('Conversation changed. Reload before retrying.', 409)
    if (remove) { await tx.delete('mirachatsessions', id); return null }
    const next = { ...session, updatedAt: new Date() }
    if (input.title !== undefined) next.title = title(input.title)
    if (input.replaceFromIndex !== undefined) {
      const index = input.replaceFromIndex
      if (!Number.isInteger(index) || index < 0 || !Number.isInteger(input.expectedMessageCount) || messages?.length !== 2 || messages[0].role !== 'user' || messages[1].role !== 'assistant') fail('Invalid replacement turn')
      if (session.messages.length !== input.expectedMessageCount || session.messages[index]?.role !== 'user') fail('Conversation changed. Reload before retrying.', 409)
      next.messages = [...session.messages.slice(0, index), ...messages]
      next.lastMessageAt = new Date()
    } else if (messages?.length) {
      next.messages = [...(session.messages || []), ...messages]
      next.lastMessageAt = new Date()
      if (input.autoTitle && (!session.title || session.title === 'New Chat') && !(session.messages || []).length) {
        const first = messages.find(message => message.role === 'user')
        if (first) next.title = first.content.slice(0, 50) + (first.content.length > 50 ? '...' : '')
      }
    }
    await tx.replace('mirachatsessions', next)
    return next
  }, { maxWrites: 400 })
}
