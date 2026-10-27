jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } }))
jest.mock('@/lib/permissions', () => ({ requirePermission: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/miraActions', () => ({ ...jest.requireActual('@/lib/miraActions'), prepareMiraAction: jest.fn() }))
jest.mock('@/app/api/tasks/create/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/projects/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/meetings/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/chat/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/chat/[chatId]/messages/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/tasks/[taskId]/assign/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/projects/[projectId]/members/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/meetings/[id]/route', () => ({ PUT: jest.fn() }))
import { POST } from '@/app/api/ai/mira-actions/route'
import { requirePermission } from '@/lib/permissions'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { prepareMiraAction } from '@/lib/miraActions'
import { POST as createTask } from '@/app/api/tasks/create/route'
import { POST as createProject } from '@/app/api/projects/route'
import { POST as createMeeting } from '@/app/api/meetings/route'
import { POST as createChat } from '@/app/api/chat/route'
import { POST as sendMessage } from '@/app/api/chat/[chatId]/messages/route'
import { POST as assignTask } from '@/app/api/tasks/[taskId]/assign/route'
import { POST as inviteProject } from '@/app/api/projects/[projectId]/members/route'
import { PUT as inviteMeeting } from '@/app/api/meetings/[id]/route'

let database, rows, revoked
const id = '507f1f77bcf86cd799439011'
const task = { type: 'create_task', fields: { title: 'Review draft', assignees: ['me'] } }
const run = (action = task, extra = {}) => POST(new Request('https://talio.test/api/ai/mira-actions', { method: 'POST', body: JSON.stringify({ action, confirmed: true, requestId: 'execution-1:task-1', ...extra }) }))
beforeEach(() => {
  jest.clearAllMocks(); rows = new Map(); revoked = false
  let tail = Promise.resolve()
  database = { transaction: jest.fn(async callback => {
    let release; const previous = tail; tail = new Promise(resolve => { release = resolve }); await previous
    try { return await callback({
      get: async (collection, key) => structuredClone(rows.get(`${collection}:${key}`) || null),
      create: async (collection, value) => { rows.set(`${collection}:${value._id}`, structuredClone(value)) },
      replace: async (collection, value) => { rows.set(`${collection}:${value._id}`, structuredClone(value)) },
    }) } finally { release() }
  }) }
  requirePermission.mockImplementation(() => async () => revoked ? { denied: new Response('', { status: 403 }) }
    : { user: { _id: 'owner-A', employeeId: 'employee-A' }, tenant: { databaseName: 'talio_company_A' }, database })
  getFirestoreTenantDatabase.mockResolvedValue(database)
  prepareMiraAction.mockResolvedValue({ path: '/api/tasks/create', page: 'tasks', body: { title: 'Review draft', assigneeIds: ['employee-A'] } })
  for (const delegate of [createTask, createProject, createMeeting, sendMessage, assignTask, inviteProject, inviteMeeting]) delegate.mockImplementation(async () => new Response(JSON.stringify({ success: true, message: 'Created', data: { _id: id } }), { status: 201 }))
})

test('the authenticated task creation shape returns its ID and is cached without duplicate writes', async () => {
  const first = await run(), body = await first.json()
  expect(body).toMatchObject({ success: true, resource: { page: 'tasks', id } })
  const second = await run()
  expect(second.status).toBe(first.status)
  expect(await second.json()).toEqual(body)
  expect(createTask).toHaveBeenCalledTimes(1)
  expect(second.headers.get('cache-control')).toBe('no-store')
})

test('concurrent requests claim before the delegate and block a second invocation', async () => {
  let release, entered
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  createTask.mockImplementationOnce(async () => { entered(); await waiting; return new Response(JSON.stringify({ success: true })) })
  const first = run(); await started
  expect([...rows.values()][0].status).toBe('pending')
  const duplicate = await run()
  expect(duplicate.status).toBe(409)
  expect(await duplicate.json()).toMatchObject({ success: false, uncertain: true })
  expect(createTask).toHaveBeenCalledTimes(1)
  release(); expect((await first).status).toBe(200)
})

test('payload collisions do not run a second delegate', async () => {
  await run()
  expect((await run({ ...task, fields: { ...task.fields, title: 'Different task' } })).status).toBe(409)
  expect(createTask).toHaveBeenCalledTimes(1)
})

test('revoking permission prevents cached receipt disclosure and delegate replay', async () => {
  await run(); const reads = database.transaction.mock.calls.length; revoked = true
  const response = await run()
  expect(response.status).toBe(403)
  expect(database.transaction).toHaveBeenCalledTimes(reads)
  expect(createTask).toHaveBeenCalledTimes(1)
})

test('a network failure after a delegate call is persisted as uncertain and never replayed', async () => {
  createTask.mockRejectedValueOnce(new Error('Write committed but result lost'))
  const first = await run()
  expect(first.status).toBe(503)
  expect(await first.json()).toMatchObject({ success: false, uncertain: true })
  expect((await run()).status).toBe(409)
  expect(createTask).toHaveBeenCalledTimes(1)
  expect([...rows.values()][0].status).toBe('uncertain')
})

test('an explicit uncertain delegate result is not mistaken for a known non-delivery', async () => {
  createTask.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, uncertain: true, message: 'Some work may have completed' }), { status: 400 }))
  const first = await run()
  expect(first.status).toBe(400)
  expect(await first.json()).toMatchObject({ uncertain: true })
  expect((await run()).status).toBe(409)
  expect(createTask).toHaveBeenCalledTimes(1)
})

test('preview and lookup/navigation reads never allocate write receipts', async () => {
  expect((await (await run(task, { confirmed: false, requestId: 'x'.repeat(201) })).json()).preview).toEqual(task)
  prepareMiraAction.mockResolvedValueOnce({ path: 'navigate', page: 'tasks', id, name: 'Draft' })
  expect((await (await run({ type: 'open_task', fields: { query: 'Draft' } })).json()).navigation.id).toBe(id)
  expect(database.transaction).not.toHaveBeenCalled()
  expect(createTask).not.toHaveBeenCalled()
})

test('a long request identity fails before a claim or delegate', async () => {
  expect((await run(task, { requestId: 'x'.repeat(201) })).status).toBe(400)
  expect(database.transaction).not.toHaveBeenCalled()
  expect(createTask).not.toHaveBeenCalled()
})

test.each([
  [{ type: 'create_project', fields: { name: 'Launch', startDate: '2099-01-01', endDate: '2099-02-01', heads: ['me'] } }, '/api/projects', createProject],
  [{ type: 'create_meeting', fields: { title: 'Review', agenda: 'Plan', scheduledStart: '2099-01-01T09:00:00Z', scheduledEnd: '2099-01-01T10:00:00Z', invitees: ['me'], type: 'online' } }, '/api/meetings', createMeeting],
  [{ type: 'assign_task', fields: { taskTitle: 'Draft', assignees: ['me'] } }, '/api/tasks/assign-existing', assignTask],
  [{ type: 'send_message', fields: { recipient: 'employee:bbbbbbbbbbbbbbbbbbbbbbbb', content: 'Hello' } }, '/api/chat/direct-message', sendMessage],
  [{ type: 'invite_project', fields: { query: 'Launch', invitees: ['me'] } }, '/api/projects/invite-existing', inviteProject],
  [{ type: 'invite_meeting', fields: { query: 'Review', invitees: ['me'] } }, '/api/meetings/invite-existing', inviteMeeting],
])('%s delegates once and reuses its completed receipt', async (action, path, delegate) => {
  prepareMiraAction.mockResolvedValue({ path, page: 'test', id, body: {} })
  expect((await run(action)).status).toBe(200)
  expect((await run(action)).status).toBe(200)
  expect(delegate).toHaveBeenCalledTimes(1)
})

test('a created chat followed by an uncertain send cannot create or send again', async () => {
  prepareMiraAction.mockResolvedValue({ path: '/api/chat/start-and-send', recipient: id, body: { content: 'Hello' } })
  createChat.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { _id: id } })))
  sendMessage.mockRejectedValueOnce(new Error('Response disappeared after send'))
  const action = { type: 'send_message', fields: { recipient: 'Sahil', content: 'Hello' } }
  expect((await run(action)).status).toBe(503)
  expect((await run(action)).status).toBe(409)
  expect(createChat).toHaveBeenCalledTimes(1)
  expect(sendMessage).toHaveBeenCalledTimes(1)
})

test('cancellation after chat creation prevents the subsequent send and preserves uncertainty', async () => {
  const controller = new AbortController()
  prepareMiraAction.mockResolvedValue({ path: '/api/chat/start-and-send', recipient: id, body: { content: 'Hello' } })
  createChat.mockImplementationOnce(async () => { controller.abort(); return new Response(JSON.stringify({ success: true, data: { _id: id } })) })
  const action = { type: 'send_message', fields: { recipient: 'Sahil', content: 'Hello' } }
  const response = await POST(new Request('https://talio.test/api/ai/mira-actions', { method: 'POST', signal: controller.signal,
    body: JSON.stringify({ action, confirmed: true, requestId: 'execution-1:task-1' }) }))
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ uncertain: true })
  expect(sendMessage).not.toHaveBeenCalled()
  expect((await run(action)).status).toBe(409)
  expect(createChat).toHaveBeenCalledTimes(1)
})
