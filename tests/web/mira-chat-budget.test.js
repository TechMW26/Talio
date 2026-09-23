import { compactMiraHistory, miraChatUseCase } from '@/lib/miraChatBudget'

test('bounds history and keeps newest turns without mutating messages', () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}:` + 'x'.repeat(20000) }))
  const result = compactMiraHistory(messages)
  expect(result.reduce((sum, m) => sum + m.content.length, 0)).toBeLessThanOrEqual(16000)
  expect(result.at(-1).content.startsWith('29:')).toBe(true)
  expect(result.every(m => m.content.length <= 4000)).toBe(true)
  expect(messages[0].content.length).toBeGreaterThan(20000)
})
test('keeps action truth without including returned database documents', () => {
  const result = compactMiraHistory([{ role: 'assistant', content: 'Sent.', data: {
    action: { type: 'send_message', fields: { recipient: 'Sahil', content: 'Hello' } },
    actionResult: { success: true, message: 'Sent.', documents: 'private'.repeat(10000) },
  } }])
  expect(result[0].content).toContain('"success":true')
  expect(result[0].content).not.toContain('private')
})
test.each(['What is my task due date?', 'Show my projects', 'Hello'])('routine read uses fast model: %s', query => {
  expect(miraChatUseCase(query)).toBe('mira')
})
test.each(['Create a project', 'Send Hello to Sahil', 'Analyze project risks', 'टास्क बना दो'])('complex work uses reasoning: %s', query => {
  expect(miraChatUseCase(query)).toBe('mira-actions')
})
