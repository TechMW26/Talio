const providerKeys = ['BRAVE_SEARCH_API_KEY', 'GOOGLE_SEARCH_API_KEY', 'GOOGLE_SEARCH_CX', 'JINA_API_KEY']
const previousKeys = Object.fromEntries(providerKeys.map(key => [key, process.env[key]]))
const braveResults = {
  web: { results: [
    { title: 'NASA Artemis mission', description: 'NASA Artemis mission exploration program.', url: 'https://www.nasa.gov/artemis/' },
    { title: 'NASA Artemis mission overview', description: 'Artemis mission science and lunar exploration.', url: 'https://science.nasa.gov/artemis/' },
  ] },
}
const response = value => ({ ok: true, json: async () => value, text: async () => '' })
const waitForAbort = signal => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(signal.reason), { once: true })
})

beforeEach(() => {
  jest.resetModules()
  jest.useFakeTimers()
  providerKeys.forEach(key => delete process.env[key])
  process.env.BRAVE_SEARCH_API_KEY = 'test-search-key'
  global.fetch = jest.fn()
})
afterEach(() => jest.useRealTimers())
afterAll(() => providerKeys.forEach(key => {
  if (previousKeys[key] === undefined) delete process.env[key]
  else process.env[key] = previousKeys[key]
}))

test('returns grounded early results and cancels slow losing providers', async () => {
  const signals = []
  fetch.mockImplementation(async (url, options) => {
    if (url.startsWith('https://api.search.brave.com')) return response(braveResults)
    signals.push(options.signal)
    return waitForAbort(options.signal)
  })
  const { searchMiraInternet } = require('@/lib/miraWebSearch')
  const pending = searchMiraInternet('NASA Artemis mission')
  await jest.advanceTimersByTimeAsync(200)
  const result = await pending
  expect(result.results).toHaveLength(2)
  expect(result.results.every(item => item.url.startsWith('https://'))).toBe(true)
  expect(result.searchMeta.elapsedMs).toBeLessThan(250)
  expect(signals.every(signal => signal.aborted)).toBe(true)
})

test('shares concurrent work without allowing one cancelled caller to cancel another, then serves cache', async () => {
  fetch.mockImplementation(async (url, options) => url.startsWith('https://api.search.brave.com')
    ? response(braveResults) : waitForAbort(options.signal))
  const { searchMiraInternet } = require('@/lib/miraWebSearch')
  const caller = new AbortController()
  const cancelled = searchMiraInternet('NASA Artemis mission', { signal: caller.signal })
  const rejects = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
  const survivor = searchMiraInternet('NASA Artemis mission')
  caller.abort()
  await jest.advanceTimersByTimeAsync(200)
  await rejects
  const result = await survivor
  expect(result.results).toHaveLength(2)
  expect(fetch.mock.calls.filter(([url]) => url.startsWith('https://api.search.brave.com'))).toHaveLength(1)
  const calls = fetch.mock.calls.length
  const cached = await searchMiraInternet('NASA Artemis mission')
  expect(cached.searchMeta.cacheHit).toBe(true)
  cached.results[0].title = 'Changed by caller'
  expect((await searchMiraInternet('NASA Artemis mission')).results[0].title).not.toBe('Changed by caller')
  expect(fetch).toHaveBeenCalledTimes(calls)
})

test('query recovery uses the standalone compound-word strategy when the first providers find nothing', async () => {
  fetch.mockImplementation(async url => {
    const parsed = new URL(url)
    if (parsed.hostname === 'api.search.brave.com') return response(/algae tree/i.test(parsed.searchParams.get('q')) ? {
      web: { results: [{ title: 'Algae Tree', description: 'Algae Tree is a public environmental technology project.', url: 'https://example.org/algae-tree' }] },
    } : { web: { results: [] } })
    return response({})
  })
  const { searchMiraInternet } = require('@/lib/miraWebSearch')
  const pending = searchMiraInternet('Algaetree')
  await jest.advanceTimersByTimeAsync(200)
  expect(await pending).toMatchObject({ results: [expect.objectContaining({ title: 'Algae Tree' })], searchMeta: { attempts: 2, recovered: true } })
})

test('enforces the total lookup deadline even if every provider hangs', async () => {
  const signals = []
  fetch.mockImplementation((url, options) => { signals.push(options.signal); return waitForAbort(options.signal) })
  const { searchMiraInternet } = require('@/lib/miraWebSearch')
  const pending = searchMiraInternet('NASA Artemis mission', { timeoutMs: 250 })
  await jest.advanceTimersByTimeAsync(300)
  const result = await pending
  expect(result.results).toEqual([])
  expect(result.unavailable).toBeTruthy()
  expect(result.searchMeta.elapsedMs).toBeLessThanOrEqual(250)
  expect(signals.every(signal => signal.aborted)).toBe(true)
})

test.each(['Search my previous chats', 'https://example.org/?token=private-value', 'https://localhost/private', 'user@example.com', 'search my missed calls', 'Find my upcoming meetings', 'मेरे ईमेल खोजें', 'apikey_0123456789abcdef'])('never sends private queries to any provider: %s', async query => {
  const { searchMiraInternet } = require('@/lib/miraWebSearch')
  expect((await searchMiraInternet(query)).unavailable).toBeTruthy()
  expect(fetch).not.toHaveBeenCalled()
})

test('filters unsafe source links and irrelevant snippets before citing evidence', async () => {
  fetch.mockImplementation(async url => url.startsWith('https://api.search.brave.com') ? response({ web: { results: [
    ...braveResults.web.results,
    { title: 'NASA Artemis mission', description: 'NASA Artemis mission', url: 'javascript:alert(1)' },
    { title: 'NASA Artemis mission', description: 'NASA Artemis mission', url: 'http://127.0.0.1/private' },
    { title: 'Pizza delivery', description: 'Fresh pizza nearby', url: 'https://example.net/pizza' },
  ] } }) : response({}))
  const { searchMiraInternet } = require('@/lib/miraWebSearch')
  const pending = searchMiraInternet('NASA Artemis mission')
  await jest.advanceTimersByTimeAsync(200)
  expect((await pending).results).toHaveLength(2)
})

test('Hindi current-news requests use fresh provider settings and reject stale/future-dated evidence', async () => {
  const { detectFreshnessIntent, freshnessWindow, rankFreshResults } = require('@/lib/miraSearchFreshness')
  expect(detectFreshnessIntent('आज की ताजा खबर')).toBe(true)
  expect(freshnessWindow('आज दिल्ली समाचार').maxAgeDays).toBe(2)
  const now = Date.parse('2026-10-28T12:00:00Z')
  expect(rankFreshResults([
    { title: 'Old', url: 'https://example.com/old', publishedAt: '2025-01-01' },
    { title: 'Future', url: 'https://example.com/future', publishedAt: '2027-01-01' },
  ], { now, maxAgeDays: 2 })).toEqual([])
})

test('an early search cancellation does not put Jina into failure cooldown', async () => {
  process.env.JINA_API_KEY = 'test-jina-key'
  const { searchJina } = require('@/lib/miraJinaSearch')
  const caller = new AbortController()
  fetch.mockImplementationOnce((url, options) => waitForAbort(options.signal))
  const cancelled = searchJina('NASA mission first', { signal: caller.signal })
  caller.abort()
  expect(await cancelled).toBeNull()
  fetch.mockResolvedValueOnce(response({ data: [{ title: 'NASA mission', description: 'NASA mission evidence', url: 'https://nasa.gov/mission' }] }))
  expect(await searchJina('NASA mission next')).toHaveLength(1)
})
