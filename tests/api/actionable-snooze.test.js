jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/cache', () => ({ buildCacheKey: jest.fn(() => 'key'), getCache: jest.fn(), setCache: jest.fn().mockResolvedValue(), buildCachePattern: jest.fn(() => 'pattern'), clearCachePattern: jest.fn().mockResolvedValue() }))
import { getAuthAndDatabase } from '@/lib/auth'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getCache } from '@/lib/cache'
import { PATCH } from '@/app/api/actionable-notifications/[id]/route'
import { GET } from '@/app/api/actionable-notifications/route'
import { workflowStore } from '../helpers/firestoreWorkflowStore'
const id = '507f1f77bcf86cd799439011'
let database
beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers().setSystemTime(new Date('2026-09-24T12:00:00Z'))
  database = { ...workflowStore({ actionablenotifications: [{ _id: id, user: 'owner', status: 'pending', priority: 'high', createdAt: new Date(), actions: [] }] }), databaseName: 'talio_company_test' }
  getFirestoreTenantDatabase.mockResolvedValue(database)
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'owner' }, tenant: { databaseName: database.databaseName } })
})
afterEach(() => jest.useRealTimers())
const snooze = () => PATCH(new Request('https://talio.test/api/actionable-notifications/' + id, { method: 'PATCH', body: JSON.stringify({ action: 'snooze', snoozedUntil: '2099-01-01' }) }), { params: Promise.resolve({ id }) })
test('snooze lasts exactly one server-timed hour and changes no decision fields', async () => {
  const response = await snooze()
  expect(response.status).toBe(200)
  expect((await response.json()).snoozedUntil).toBe('2026-09-24T13:00:00.000Z')
  expect(await database.get('actionablenotifications', id)).toMatchObject({ status: 'pending', snoozedUntil: new Date('2026-09-24T13:00:00Z') })
})
test('foreign or resolved notifications cannot be snoozed', async () => {
  await database.mutate('actionablenotifications', id, record => ({ ...record, user: 'someone_else' }))
  expect((await snooze()).status).toBe(404)
  await database.mutate('actionablenotifications', id, record => ({ ...record, user: 'owner', status: 'actioned' }))
  expect((await snooze()).status).toBe(409)
})
test('unauthenticated snoozing is rejected', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: false, message: 'Unauthorized' })
  expect((await snooze()).status).toBe(401)
  expect(database.transaction).not.toHaveBeenCalled()
})
test('pending reminders are queried fresh and exclude snoozed or expired notifications', async () => {
  await snooze()
  await database.create('actionablenotifications', { _id: 'expired', user: 'owner', status: 'pending', priority: 'urgent', createdAt: new Date(), expiresAt: new Date('2026-09-23') })
  const response = await GET(new Request('https://talio.test/api/actionable-notifications'))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ count: 0, nextReminderAt: '2026-09-24T13:00:00.000Z' })
  expect(getCache).not.toHaveBeenCalled()
})
