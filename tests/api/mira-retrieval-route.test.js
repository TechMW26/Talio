jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/gemini', () => ({ generateContent: jest.fn() }))
jest.mock('@/lib/ai/aiProviderManager', () => ({ streamContent: jest.fn() }))
jest.mock('@/lib/ai/providers/deepseekProvider', () => ({ generateDeepSeekContent: jest.fn() }))
jest.mock('@/lib/miraWebSearch', () => ({ searchMiraInternet: jest.fn() }))
import { getAuthAndDatabase } from '@/lib/auth'
import { generateContent } from '@/lib/gemini'
import { generateDeepSeekContent } from '@/lib/ai/providers/deepseekProvider'
import { searchMiraInternet } from '@/lib/miraWebSearch'
import { POST } from '@/app/api/ai/mira-chat/route'

let database
const oldKey = process.env.DEEPSEEK_API_KEY
beforeEach(() => {
  jest.clearAllMocks(); process.env.DEEPSEEK_API_KEY = 'test'
  const user = { _id: 'A', employeeId: 'emp-A', role: 'employee', isActive: true }
  database = { get: jest.fn(async collection => collection === 'users' ? user : null), create: jest.fn(), replace: jest.fn(), list: jest.fn(async collection => ({ records: collection === 'mirachatsessions' ? [
    { _id: 'old-chat', user: 'A', title: 'Drawing budget', lastMessageAt: '2026-10-01', messages: [{ role: 'user', content: 'My drawing budget is 2500 rupees.' }] },
    { _id: 'foreign', user: 'B', title: 'Drawing budget', messages: [{ role: 'user', content: 'PRIVATE_OTHER_USER' }] },
  ] : [] })) }
  database.transaction = async fn => fn(database)
  getAuthAndDatabase.mockResolvedValue({ success: true, user, database, tenant: { databaseName: 'tenant-A' } })
  generateContent.mockResolvedValue(JSON.stringify({ message: 'Your budget was 2500 rupees.', cards: [], suggestedQuestions: [] }))
})
afterAll(() => { if (oldKey) process.env.DEEPSEEK_API_KEY = oldKey; else delete process.env.DEEPSEEK_API_KEY })
const run = message => POST(new Request('https://app.talio.in/api/ai/mira-chat', { method: 'POST', body: JSON.stringify({ message, inputMode: 'voice' }) }))
test('voice bridge and typed chat share authorized cross-chat retrieval in generation context', async () => {
  generateDeepSeekContent.mockResolvedValue('{"kind":"history","query":"drawing budget"}')
  const response = await run('What budget did I mention in another chat?')
  expect(response.status).toBe(200)
  const prompt = generateContent.mock.calls[0][1]
  expect(prompt).toContain('My drawing budget is 2500 rupees.')
  expect(prompt).toContain('old-chat')
  expect(prompt).not.toContain('PRIVATE_OTHER_USER')
  expect(prompt).toContain('historical claim is not a verified current fact')
  expect(searchMiraInternet).not.toHaveBeenCalled()
  expect(database.list.mock.calls.some(([collection]) => collection === 'attendances')).toBe(false)
})
test('semantic web routing supplies real sources to the answer without loading chat archives', async () => {
  generateDeepSeekContent.mockResolvedValue('{"kind":"web","query":"Algaetree"}')
  searchMiraInternet.mockResolvedValue({ source: 'test web', results: [{ title: 'Algaetree', url: 'https://example.com/algaetree', snippet: 'Public description' }] })
  expect((await run('Tell me about Algaetree')).status).toBe(200)
  expect(searchMiraInternet).toHaveBeenCalledWith('Algaetree', { signal: expect.any(AbortSignal) })
  expect(generateContent.mock.calls[0][1]).toContain('https://example.com/algaetree')
  expect(database.list.mock.calls.some(([collection]) => collection === 'mirachatsessions')).toBe(false)
})
test('unauthorized callers cannot invoke retrieval or AI', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: false, status: 401, message: 'Sign in' })
  expect((await run('Recall previous chats')).status).toBe(401)
  expect(database.list).not.toHaveBeenCalled()
  expect(generateDeepSeekContent).not.toHaveBeenCalled()
})
