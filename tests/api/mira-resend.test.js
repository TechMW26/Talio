jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status || 200 }) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
import { getAuthAndDatabase } from '@/lib/auth'
import { PATCH } from '@/app/api/ai/mira-chat/sessions/[id]/route'

const history = [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'first reply' }, { role: 'user', content: 'old' }, { role: 'assistant', content: 'old reply' }]
const replacement = [{ role: 'user', content: 'edited' }, { role: 'assistant', content: 'new reply' }]
let database, session
const sessionId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
beforeEach(() => {
  session = { _id: sessionId, user: 'owner', messages: history, updatedAt: 'revision', title: 'Chat' }
  database = { get: jest.fn(async collection => collection === 'users' ? { _id: 'owner', isActive: true } : session), replace: jest.fn(async (_collection, row) => { session = row }) }
  database.transaction = jest.fn(async fn => fn(database))
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'owner' }, database })
})
const run = body => PATCH(new Request('http://localhost/test', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: sessionId }) })
test('resend preserves earlier context and updates the same owned session', async () => {
  expect((await run({ replaceFromIndex: 2, expectedMessageCount: 4, messages: replacement })).status).toBe(200)
  expect(database.replace).toHaveBeenCalledWith('mirachatsessions', expect.objectContaining({ _id: sessionId, user: 'owner', lastMessageAt: expect.any(Date) }))
  expect(session.messages.map(({ role, content }) => ({ role, content }))).toEqual([...history.slice(0, 2), ...replacement])
})
test.each([[-1, 400], [1, 409], [9, 409]])('rejects invalid or non-user index %s', async (replaceFromIndex, status) => {
  expect((await run({ replaceFromIndex, expectedMessageCount: 4, messages: replacement })).status).toBe(status)
  expect(database.replace).not.toHaveBeenCalled()
})
test('rejects stale conversation and unauthorized callers', async () => {
  expect((await run({ replaceFromIndex: 2, expectedMessageCount: 3, messages: replacement })).status).toBe(409)
  getAuthAndDatabase.mockResolvedValue({ success: false, message: 'Unauthorized' })
  expect((await run({})).status).toBe(401)
})
