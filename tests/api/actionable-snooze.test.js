jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/cache', () => ({ buildCacheKey: jest.fn(() => 'key'), getCache: jest.fn(), setCache: jest.fn().mockResolvedValue(), buildCachePattern: jest.fn(() => 'pattern'), clearCachePattern: jest.fn().mockResolvedValue() }))
import { getAuthAndModels } from '@/lib/auth'
import { getCache } from '@/lib/cache'
import { PATCH } from '@/app/api/actionable-notifications/[id]/route'
import { GET } from '@/app/api/actionable-notifications/route'
const id = '507f1f77bcf86cd799439011'
const chain = rows => ({ sort() { return this }, limit() { return this }, select() { return this }, populate() { return this }, lean: async () => rows })
let model
beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers().setSystemTime(new Date('2026-09-24T12:00:00Z'))
  model = { findOneAndUpdate: jest.fn().mockResolvedValue({ _id: id, status: 'pending' }), find: jest.fn(() => chain([])), findOne: jest.fn(() => chain({ snoozedUntil: new Date('2026-09-24T13:00:00Z') })) }
  getAuthAndModels.mockResolvedValue({ success: true, user: { _id: 'owner' }, tenant: { databaseName: 'tenant-a' }, models: { ActionableNotification: model } })
})
afterEach(() => jest.useRealTimers())
const snooze = () => PATCH(new Request('https://talio.test/api/actionable-notifications/' + id, { method: 'PATCH', body: JSON.stringify({ action: 'snooze', snoozedUntil: '2099-01-01' }) }), { params: Promise.resolve({ id }) })
test('snooze lasts exactly one server-timed hour and changes no decision fields', async () => {
  const response = await snooze()
  expect(response.status).toBe(200)
  expect((await response.json()).snoozedUntil).toBe('2026-09-24T13:00:00.000Z')
  expect(model.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ _id: id, user: 'owner', status: 'pending' }), { $set: { snoozedUntil: new Date('2026-09-24T13:00:00Z') } }, expect.objectContaining({ new: true }))
})
test('foreign or resolved notifications cannot be snoozed', async () => {
  model.findOneAndUpdate.mockResolvedValue(null)
  expect((await snooze()).status).toBe(409)
})
test('unauthenticated snoozing is rejected', async () => {
  getAuthAndModels.mockResolvedValue({ success: false, message: 'Unauthorized' })
  expect((await snooze()).status).toBe(401)
  expect(model.findOneAndUpdate).not.toHaveBeenCalled()
})
test('pending reminders are queried fresh and exclude snoozed or expired notifications', async () => {
  const response = await GET(new Request('https://talio.test/api/actionable-notifications'))
  expect(response.status).toBe(200)
  expect((await response.json()).nextReminderAt).toBe('2026-09-24T13:00:00.000Z')
  expect(getCache).not.toHaveBeenCalled()
  expect(model.find.mock.calls[0][0]).toEqual({ user: 'owner', status: 'pending', $and: [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }, { $or: [{ snoozedUntil: null }, { snoozedUntil: { $lte: new Date() } }] }] })
})
