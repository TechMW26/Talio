import { getAuthAndDatabase } from '@/lib/auth'
import { getPusherServer } from '@/lib/pusherServer'
import { POST as authorize } from '@/app/api/realtime/auth/route'
import { POST as publish } from '@/app/api/realtime/events/route'
import { rateLimit } from '@/lib/security/rateLimiter'
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/pusherServer', () => ({ getPusherServer: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn(), buildRateLimitHeaders: () => ({}) }))
const userId = '507f1f77bcf86cd799439011'
const chatId = '507f1f77bcf86cd799439012'
const employeeId = '507f1f77bcf86cd799439013'
const authRequest = channel => ({ formData: async () => new Map([['socket_id', '1.2'], ['channel_name', channel]]) })
const eventRequest = body => ({ json: async () => body })
let trigger, sign, auth, chat
beforeEach(() => {
  jest.clearAllMocks()
  trigger = jest.fn().mockResolvedValue({})
  sign = jest.fn().mockReturnValue({ auth: 'signed' })
  getPusherServer.mockReturnValue({ trigger, authorizeChannel: sign })
  rateLimit.mockResolvedValue({ allowed: true })
  chat = { _id: chatId, participants: [employeeId] }
  auth = { success: true, user: { _id: userId, employeeId, isActive: true }, tenant: { databaseName: 'tenant_a' }, database: {
    get: jest.fn(async (collection, id) => collection === 'users' ? auth.user : collection === 'employees' ? { _id: employeeId, firstName: 'Verified', lastName: 'Name' } : collection === 'chats' ? chat : null),
    list: jest.fn(async () => ({ records: [] })),
  } }
  getAuthAndDatabase.mockResolvedValue(auth)
})
test.each(['private-global', 'private-tenant-tenant_b', `private-user-tenant_a--${chatId}`, `private-project-tenant_a--${chatId}`, `private-user-tenant_b--${userId}`, `private-chat-tenant_b--${chatId}`])('rejects unauthorized channel %s', async channel => {
  expect((await authorize(authRequest(channel))).status).toBe(403)
  expect(sign).not.toHaveBeenCalled()
})
test.each([`private-user-tenant_a--${userId}`, 'private-tenant-tenant_a', `private-chat-tenant_a--${chatId}`])('signs authorized channel %s', async channel => {
  expect((await authorize(authRequest(channel))).status).toBe(200)
  expect(sign).toHaveBeenCalledWith('1.2', channel)
})
test('requires authenticated identity', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: false })
  expect((await authorize(authRequest(`private-user-tenant_a--${userId}`))).status).toBe(401)
  expect((await publish(eventRequest({ event: 'typing', chatId }))).status).toBe(401)
})
test('rejects malformed and unscoped channels without querying storage', async () => {
  expect((await authorize({ formData: async () => { throw new Error('bad form') } })).status).toBe(400)
  expect((await authorize(authRequest('private-chat-invalid'))).status).toBe(400)
  expect((await authorize(authRequest(`private-user-${userId}`))).status).toBe(400)
  expect(getAuthAndDatabase).not.toHaveBeenCalled()
})
test('does not accept client-forged events or identity', async () => {
  expect((await publish(eventRequest({ event: 'new-message', chatId }))).status).toBe(400)
  expect((await publish(eventRequest(null))).status).toBe(400)
  expect((await publish(eventRequest({ event: 'typing', chatId, userName: 'Forged', userId: chatId }))).status).toBe(200)
  expect(trigger).toHaveBeenCalledWith(`private-chat-tenant_a--${chatId}`, 'user-typing', { chatId, userId, userName: 'Verified Name' })
})
test('cannot publish outside membership, including account IDs mistaken for employees', async () => {
  chat.participants = [userId]
  expect((await publish(eventRequest({ event: 'typing', chatId }))).status).toBe(403)
  expect(trigger).not.toHaveBeenCalled()
})
test('rate limits hints before querying participants', async () => {
  rateLimit.mockResolvedValue({ allowed: false })
  expect((await publish(eventRequest({ event: 'typing', chatId }))).status).toBe(429)
  expect(auth.database.get).not.toHaveBeenCalled()
})
test('provider failure returns an explicit retryable response', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
  trigger.mockRejectedValue(new Error('unavailable'))
  expect((await publish(eventRequest({ event: 'typing', chatId }))).status).toBe(503)
  spy.mockRestore()
})
