import { miraAnswerCacheKey, readMiraAnswer, saveMiraAnswer } from '@/lib/miraAnswerCache.server'
const input = { tenant: 't', user: 'u', message: 'Explain photosynthesis', prompt: 'Explain photosynthesis', system: 'policy\nReminder scheduling reference: today\n{"asOf":"2026-10-19T00:00:00Z"}', model: 'model', eligible: true }
test('timeless answers reuse exact context with bounded TTL and account isolation', () => {
  jest.useFakeTimers()
  try {
    const key = miraAnswerCacheKey(input), text = JSON.stringify({ message: 'Plants convert sunlight into chemical energy.' })
    saveMiraAnswer(key, text)
    expect(readMiraAnswer(key)).toBe(text)
    expect(miraAnswerCacheKey({ ...input, system: input.system.replace('today', 'tomorrow').replace('00:00:00', '00:01:00') })).toBe(key)
    for (const change of [{ user: 'other' }, { tenant: 'other' }, { model: 'new' }, { system: 'different policy' }, { prompt: 'new history' }]) expect(readMiraAnswer(miraAnswerCacheKey({ ...input, ...change }))).toBeNull()
    jest.advanceTimersByTime(300001)
    expect(readMiraAnswer(key)).toBeNull()
  } finally { jest.useRealTimers() }
})
test.each(['What is my salary?', 'What is the weather?', 'Explain this screen', 'What is the current price?', 'Open Notes'])('live or action query %s bypasses answer cache', message => {
  expect(miraAnswerCacheKey({ ...input, message })).toBeNull()
})
test.each([{ action: { type: 'desktop_task' } }, { cards: [{}] }, { taskBank: { tasks: [{}] } }, { tool_calls: [{}] }, { actionResult: { success: true } }])('never caches execution-bearing outputs %p', value => {
  const key = miraAnswerCacheKey({ ...input, user: JSON.stringify(value) })
  saveMiraAnswer(key, JSON.stringify({ message: 'Done', ...value }))
  expect(readMiraAnswer(key)).toBeNull()
})
