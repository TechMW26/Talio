jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/permissions', () => ({ requirePermission: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
import { createHash } from 'node:crypto'
import { GET } from '@/app/api/ai/mira-actions/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { requirePermission } from '@/lib/permissions'
import { MIRA_CHAT_STORE_OPTIONS } from '@/lib/miraChatStore.server'

let rows, database, user, tenant
const requestId = 'execution-1:task-1'
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24)
const receiptKey = (owner = 'owner-A', company = 'talio_company_A') => digest(JSON.stringify([company, owner, requestId]))
const reminderKey = (owner = 'owner-A', company = 'talio_company_A') => digest(`${company}:${owner}:${requestId}`)
const call = (extra = {}, signal) => GET(new Request(`https://talio.test/api/ai/mira-actions?${new URLSearchParams({ requestId, type: 'create_task', ...extra })}`, { signal }))
const putReceipt = (changes = {}, owner = 'owner-A', company = 'talio_company_A') => rows.set(`miraactionreceipts:${receiptKey(owner, company)}`, {
  _id: receiptKey(owner, company), owner, tenant: company, actionType: 'create_task', status: 'completed', httpStatus: 201,
  response: { success: true, message: 'Task created', resource: { page: 'tasks', id: '507f1f77bcf86cd799439011' } }, ...changes,
})
beforeEach(() => {
  jest.clearAllMocks(); rows = new Map(); user = { _id: 'owner-A' }; tenant = { databaseName: 'talio_company_A' }
  database = { get: jest.fn(async (collection, id) => structuredClone(rows.get(`${collection}:${id}`) || null)), create: jest.fn(), replace: jest.fn(), transaction: jest.fn() }
  getAuthAndDatabase.mockImplementation(async () => ({ success: true, user, tenant, database }))
  requirePermission.mockImplementation(() => async () => ({ user, tenant, database }))
})
afterEach(() => {
  expect(database.create).not.toHaveBeenCalled()
  expect(database.replace).not.toHaveBeenCalled()
  expect(database.transaction).not.toHaveBeenCalled()
})

test('completed read-back returns only the stored action result and its original HTTP status', async () => {
  putReceipt({ claimToken: 'never-disclose', payloadHash: 'never-disclose-hash' })
  const response = await call(), body = await response.json()
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(body).toEqual({ success: true, found: true, state: 'completed', httpStatus: 201, outcome: { success: true, message: 'Task created', resource: { page: 'tasks', id: '507f1f77bcf86cd799439011' } } })
  expect(getAuthAndDatabase).toHaveBeenCalledWith(expect.any(Request), MIRA_CHAT_STORE_OPTIONS)
  expect(requirePermission).toHaveBeenCalledWith('tasks', 'create')
  expect(database.get).toHaveBeenCalledWith('miraactionreceipts', receiptKey())
  expect(JSON.stringify(body)).not.toContain('never-disclose')
})

test.each([401, 403])('authentication or disabled Mira access (%s) blocks even a known receipt', async status => {
  putReceipt()
  getAuthAndDatabase.mockResolvedValueOnce({ success: false, status, message: status === 403 ? 'Mira disabled' : 'Sign in' })
  expect((await call()).status).toBe(status)
  expect(requirePermission).not.toHaveBeenCalled()
  expect(database.get).not.toHaveBeenCalled()
})

test('permission revocation is checked before any completed receipt is read', async () => {
  putReceipt()
  requirePermission.mockReturnValueOnce(async () => ({ denied: new Response('', { status: 403 }) }))
  expect((await call()).status).toBe(403)
  expect(database.get).not.toHaveBeenCalled()
})

test.each(['account', 'tenant'])('a request identity cannot disclose another %s receipt', async scope => {
  putReceipt()
  if (scope === 'account') user = { _id: 'owner-B' }
  else tenant = { databaseName: 'talio_company_B' }
  expect(await (await call()).json()).toEqual({ success: true, found: false })
  expect(database.get).toHaveBeenCalledWith('miraactionreceipts', receiptKey(scope === 'account' ? 'owner-B' : 'owner-A', scope === 'tenant' ? 'talio_company_B' : 'talio_company_A'))
})

test('requesting a different write type cannot read an otherwise matching receipt', async () => {
  putReceipt()
  expect(await (await call({ type: 'send_message' })).json()).toEqual({ success: true, found: false })
  expect(requirePermission).toHaveBeenCalledWith('chat', 'create')
})

test('stored ownership is verified in addition to the derived lookup key', async () => {
  putReceipt({ owner: 'someone-else' })
  expect(await (await call()).json()).toEqual({ success: true, found: false })
})

test.each(['pending', 'uncertain'])('%s read-back is uncertain and never exposes an unverified response', async state => {
  putReceipt({ status: state, response: { success: true, message: 'Not authoritative' } })
  expect(await (await call()).json()).toMatchObject({ success: true, found: true, state, httpStatus: 409, outcome: { success: false, uncertain: true } })
  expect(JSON.stringify(await (await call()).json())).not.toContain('Not authoritative')
})

test('missing receipts return found false rather than making or retrying an action', async () => {
  expect(await (await call()).json()).toEqual({ success: true, found: false })
})

test('a known failed completion preserves the exact failed outcome for safe recovery', async () => {
  putReceipt({ httpStatus: 400, response: { success: false, uncertain: false, message: 'The target no longer exists' } })
  expect(await (await call()).json()).toEqual({ success: true, found: true, state: 'completed', httpStatus: 400, outcome: { success: false, uncertain: false, message: 'The target no longer exists' } })
})

test('only fixed receipt collections are queried; extra collection/id parameters cannot select records', async () => {
  await call({ collection: 'users', id: 'other-user' })
  expect(database.get.mock.calls).toEqual([['miraactionreceipts', receiptKey()]])
})

test.each(['pending', 'delivered', 'cancelled'])('reminder %s status confirms creation only, never delivery', async status => {
  const id = reminderKey(), scheduledFor = '2099-01-01T09:00:00.000Z'
  rows.set(`schedulednotifications:${id}`, { _id: id, metadata: { owner: 'owner-A', source: 'mira' }, scheduledFor: new Date(scheduledFor), timezone: 'Asia/Kolkata', status })
  const body = await (await call({ type: 'schedule_reminder' })).json()
  expect(body).toMatchObject({ success: true, found: true, state: 'completed', httpStatus: 200, outcome: { success: true, reminder: { id, scheduledFor, timezone: 'Asia/Kolkata' } } })
  expect(body.outcome.message).toContain('confirms scheduling only, not delivery')
  if (status === 'cancelled') expect(body.outcome.message).toContain('currently cancelled')
  expect(requirePermission).not.toHaveBeenCalled()
  expect(database.get).toHaveBeenCalledWith('schedulednotifications', id)
})

test.each([{ owner: 'other', source: 'mira' }, { owner: 'owner-A', source: 'other' }])('reminder metadata %p cannot cross owner/source boundaries', async metadata => {
  rows.set(`schedulednotifications:${reminderKey()}`, { metadata, scheduledFor: new Date('2099-01-01') })
  expect(await (await call({ type: 'schedule_reminder' })).json()).toEqual({ success: true, found: false })
})

test.each([{ requestId: '' }, { requestId: 'a'.repeat(201) }, { type: 'delete_database' }, { type: 'open_task' }])('invalid lookup %p is rejected before any record read', async extra => {
  expect((await call(extra)).status).toBe(400)
  expect(database.get).not.toHaveBeenCalled()
})

test('a previously aborted lookup cannot read or execute anything', async () => {
  const controller = new AbortController(); controller.abort()
  expect((await call({}, controller.signal)).status).toBe(499)
  expect(database.get).not.toHaveBeenCalled()
})

test('cancellation during the record read does not expose stale completion', async () => {
  putReceipt()
  const controller = new AbortController(), get = database.get
  database.get = jest.fn(async (...args) => { const row = await get(...args); controller.abort(); return row })
  expect((await call({}, controller.signal)).status).toBe(499)
})
