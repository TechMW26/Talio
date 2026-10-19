jest.mock('@/lib/ai/providers/deepseekProvider', () => ({ generateDeepSeekContent: jest.fn() }))
import { generateDeepSeekContent } from '@/lib/ai/providers/deepseekProvider'
import { planMiraRetrieval, retrieveMiraChats } from '@/lib/miraRetrieval.server'
import { normalizeSearchValue, rankSearchResults } from '@/lib/miraSearchRelevance'

const oldKey = process.env.DEEPSEEK_API_KEY
beforeEach(() => { jest.clearAllMocks(); process.env.DEEPSEEK_API_KEY = 'test' })
afterAll(() => { if (oldKey) process.env.DEEPSEEK_API_KEY = oldKey; else delete process.env.DEEPSEEK_API_KEY })
test('semantic routing handles public terms without requiring search keywords', async () => {
  generateDeepSeekContent.mockResolvedValue('{"kind":"web","query":"Algaetree"}')
  expect(await planMiraRetrieval('What is Algaetree?')).toEqual({ kind: 'web', query: 'Algaetree' })
})
test('follow-up routing sees bounded recent conversation, not an entire archive', async () => {
  generateDeepSeekContent.mockResolvedValue('{"kind":"web","query":"ISRO news today"}')
  await planMiraRetrieval('Any news today?', Array.from({ length: 40 }, () => ({ role: 'user', content: 'x'.repeat(5000) })))
  const input = JSON.parse(generateDeepSeekContent.mock.calls[0][0])
  expect(input.recentConversation).toHaveLength(6)
  expect(input.recentConversation[0].content).toHaveLength(1200)
})
test.each(['Search my previous chats for the budget', 'My password is abc123', 'Employee salary details'])('public search cannot export private inputs: %s', async message => {
  generateDeepSeekContent.mockResolvedValue('{"kind":"web","query":"private details"}')
  expect((await planMiraRetrieval(message)).kind).toBe('none')
})
test('model failure retains recall and explicit search fallbacks', async () => {
  generateDeepSeekContent.mockRejectedValue(new Error('offline'))
  expect((await planMiraRetrieval('Remember what we discussed about music?')).kind).toBe('history')
  expect((await planMiraRetrieval('Search ISRO news')).kind).toBe('web')
  expect((await planMiraRetrieval('Hello')).kind).toBe('none')
})
const chat = (id, user, text, extra = {}) => ({ _id: id, user, title: 'Music', lastMessageAt: '2026-10-19', messages: [{ role: 'user', content: text, timestamp: '2026-10-18' }, { role: 'assistant', content: 'Noted.' }], ...extra })
test('retrieves older paginated chats and preserves speaker/provenance without other users or deleted chats', async () => {
  const database = { list: jest.fn().mockResolvedValueOnce({ records: [chat('other', 'B', 'Yellow'), chat('deleted', 'A', 'Yellow', { deletedAt: new Date() })], nextCursor: 'next' }).mockResolvedValueOnce({ records: [chat('old', 'A', 'My favourite song is Yellow by Coldplay.')], nextCursor: null }) }
  const result = await retrieveMiraChats(database, 'A', 'Yellow Coldplay')
  expect(result.matches).toHaveLength(1)
  expect(result.matches[0]).toMatchObject({ sessionId: 'old', excerpts: [expect.objectContaining({ role: 'user', content: 'My favourite song is Yellow by Coldplay.' }), expect.objectContaining({ role: 'assistant' })] })
  for (const [, options] of database.list.mock.calls) expect(options.filters).toEqual([{ field: 'user', operator: '==', value: 'A' }])
  expect(database.list.mock.calls[1][1].cursor).toBe('next')
})
test('deletion is respected immediately, without stale cross-chat answer caching', async () => {
  const database = { list: jest.fn().mockResolvedValueOnce({ records: [chat('old', 'A', 'Yellow')] }).mockResolvedValueOnce({ records: [] }) }
  expect((await retrieveMiraChats(database, 'A', 'Yellow')).matches).toHaveLength(1)
  expect((await retrieveMiraChats(database, 'A', 'Yellow')).matches).toHaveLength(0)
})
test('history reads are bounded and disclose incomplete coverage', async () => {
  let page = 0
  const database = { list: jest.fn(async () => ({ records: Array.from({ length: 100 }, (_, i) => chat(`${page}-${i}`, 'A', 'music')), nextCursor: String(++page) })) }
  const result = await retrieveMiraChats(database, 'A', '')
  expect(database.list).toHaveBeenCalledTimes(5)
  expect(result.partial).toBe(true)
  expect(result.matches).toHaveLength(4)
})
test('missing history and failed history are distinct and not fabricated', async () => {
  expect(await retrieveMiraChats({ list: async () => ({ records: [] }) }, 'A', 'song')).toMatchObject({ matches: [], partial: false })
  expect(await retrieveMiraChats({ list: async () => { throw Error('offline') } }, 'A', 'song')).toMatchObject({ matches: [], unavailable: expect.any(String) })
})
test('Hindi search subjects survive relevance filtering', () => {
  expect(normalizeSearchValue('भोपाल का मौसम')).toBe('भोपाल का मौसम')
  expect(rankSearchResults([{ title: 'भोपाल मौसम', snippet: 'भोपाल का मौसम', url: 'https://example.com' }, { title: 'Unrelated', snippet: 'Pizza', url: 'https://example.org' }], 'भोपाल मौसम')).toHaveLength(1)
})
