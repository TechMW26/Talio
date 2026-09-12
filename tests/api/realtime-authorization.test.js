import { getAuthAndModels } from '@/lib/auth'
import { getPusherServer } from '@/lib/pusherServer'
import { POST as authorize } from '@/app/api/realtime/auth/route'
import { POST as publish } from '@/app/api/realtime/events/route'
import { rateLimit } from '@/lib/security/rateLimiter'
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/pusherServer', () => ({ getPusherServer: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn(), buildRateLimitHeaders: () => ({}) }))
const userId = '507f1f77bcf86cd799439011'
const chatId = '507f1f77bcf86cd799439012'
const query = value => ({ select: () => ({ lean: async () => value }) })
const authRequest = channel => ({ formData: async () => new Map([['socket_id', '1.2'], ['channel_name', channel]]) })
const eventRequest = body => ({ json: async () => body })
let trigger, sign, auth
beforeEach(() => {
  jest.clearAllMocks()
  trigger = jest.fn().mockResolvedValue({})
  sign = jest.fn().mockReturnValue({ auth: 'signed' })
  getPusherServer.mockReturnValue({ trigger, authorizeChannel: sign })
  rateLimit.mockResolvedValue({ allowed: true })
  auth = { success: true, user: { _id: userId }, tenant: { databaseName: 'tenant_a' }, models: {
    Chat: { findById: jest.fn(() => query({ participants: [userId] })) },
    User: { findById: jest.fn(() => query({ employeeId: 'employee' })) },
    Employee: { findById: jest.fn(() => query({ firstName: 'Verified', lastName: 'Name' })) },
    Project: { findById: jest.fn(() => query(null)) },
  } }
  getAuthAndModels.mockResolvedValue(auth)
})
test.each(['private-global', 'private-tenant-tenant_b', `private-user-${chatId}`, `private-project-${chatId}`])('rejects unauthorized channel %s', async channel => {
  expect((await authorize(authRequest(channel))).status).toBe(403)
  expect(sign).not.toHaveBeenCalled()
})
test.each([`private-user-${userId}`, 'private-tenant-tenant_a', `private-chat-${chatId}`])('signs authorized channel %s', async channel => {
  expect((await authorize(authRequest(channel))).status).toBe(200)
  expect(sign).toHaveBeenCalledWith('1.2', channel)
})
test('requires authenticated identity', async () => {
  getAuthAndModels.mockResolvedValue({ success: false })
  expect((await authorize(authRequest(`private-user-${userId}`))).status).toBe(401)
  expect((await publish(eventRequest({ event: 'typing', chatId }))).status).toBe(401)
})
test('rejects malformed form and resource IDs without querying storage', async () => {
  expect((await authorize({ formData: async () => { throw new Error('bad form') } })).status).toBe(400)
  expect((await authorize(authRequest('private-chat-invalid'))).status).toBe(400)
  expect(getAuthAndModels).not.toHaveBeenCalled()
})
test('does not accept client-forged events or identity', async () => {
  expect((await publish(eventRequest({ event: 'new-message', chatId }))).status).toBe(400)
  expect((await publish(eventRequest(null))).status).toBe(400)
  expect((await publish(eventRequest({ event: 'typing', chatId, userName: 'Forged', userId: chatId }))).status).toBe(200)
  expect(trigger).toHaveBeenCalledWith(`private-chat-${chatId}`, 'user-typing', { chatId, userId, userName: 'Verified Name' })
})
test('cannot publish to a chat outside membership', async () => {
  auth.models.Chat.findById.mockReturnValue(query({ participants: [chatId] }))
  expect((await publish(eventRequest({ event: 'typing', chatId }))).status).toBe(403)
  expect(trigger).not.toHaveBeenCalled()
})
test('rate limits hints before querying participants', async () => {
  rateLimit.mockResolvedValue({ allowed: false })
  expect((await publish(eventRequest({ event: 'typing', chatId }))).status).toBe(429)
  expect(auth.models.Chat.findById).not.toHaveBeenCalled()
})
test('provider failure returns an explicit retryable response', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
  trigger.mockRejectedValue(new Error('unavailable'))
  expect((await publish(eventRequest({ event: 'typing', chatId }))).status).toBe(503)
  spy.mockRestore()
})
