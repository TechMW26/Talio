jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status || 200 }) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
import { getAuthAndModels } from '@/lib/auth'
import { PATCH } from '@/app/api/ai/mira-chat/sessions/[id]/route'

const history = [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'first reply' }, { role: 'user', content: 'old' }, { role: 'assistant', content: 'old reply' }]
const replacement = [{ role: 'user', content: 'edited' }, { role: 'assistant', content: 'new reply' }]
let model
beforeEach(() => {
  model = { findOne: jest.fn(() => ({ lean: async () => ({ messages: history, updatedAt: 'revision' }) })), findOneAndUpdate: jest.fn(() => ({ lean: async () => ({ _id: 'session', title: 'Chat' }) })) }
  getAuthAndModels.mockResolvedValue({ success: true, user: { _id: 'owner' }, models: { MiraChatSession: model } })
})
const run = body => PATCH(new Request('http://localhost/test', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'session' }) })
test('resend preserves earlier context and updates the same owned session', async () => {
  expect((await run({ replaceFromIndex: 2, expectedMessageCount: 4, messages: replacement })).status).toBe(200)
  expect(model.findOneAndUpdate).toHaveBeenCalledWith({ _id: 'session', user: 'owner', updatedAt: 'revision' }, { $set: { messages: [...history.slice(0, 2), ...replacement], lastMessageAt: expect.any(Date) } }, { new: true, runValidators: true })
})
test.each([[-1, 400], [1, 409], [9, 409]])('rejects invalid or non-user index %s', async (replaceFromIndex, status) => {
  expect((await run({ replaceFromIndex, expectedMessageCount: 4, messages: replacement })).status).toBe(status)
  expect(model.findOneAndUpdate).not.toHaveBeenCalled()
})
test('rejects stale conversation and unauthorized callers', async () => {
  expect((await run({ replaceFromIndex: 2, expectedMessageCount: 3, messages: replacement })).status).toBe(409)
  getAuthAndModels.mockResolvedValue({ success: false, message: 'Unauthorized' })
  expect((await run({})).status).toBe(401)
})
