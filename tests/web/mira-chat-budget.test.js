import { compactMiraHistory, mergeMiraVoiceHistory, miraChatUseCase } from '@/lib/miraChatBudget'

test('voice chronology is not duplicated and keeps verified execution outcomes', () => {
  const user = { role: 'user', content: 'Play Yellow on YouTube Music' }
  const outcome = { role: 'assistant', content: 'Playback started.', data: { actionResult: { success: true }, action: { type: 'desktop_task' } } }
  const voice = [user, { role: 'assistant', content: 'Yellow is playing.' }, { role: 'user', content: 'Thanks' }, { role: 'assistant', content: 'Enjoy!' }]
  const result = mergeMiraVoiceHistory([user, outcome], voice)
  expect(result.map(item => item.content)).toEqual([user.content, outcome.content, 'Yellow is playing.', 'Thanks', 'Enjoy!'])
  expect(compactMiraHistory(result)[1].content).toContain('"success":true')
  expect(voice).toHaveLength(4)
})
test('matching saved replies retain metadata without adding another reply', () => {
  const visible = [{ role: 'user', content: 'Open Calculator' }, { role: 'assistant', content: 'Opened.', data: { actionResult: { success: true } } }]
  const voice = visible.map(({ role, content }) => ({ role, content }))
  expect(mergeMiraVoiceHistory(visible, voice)).toEqual(visible)
})
test('distinct repeated commands keep their own outcomes', () => {
  const user = { role: 'user', content: 'Open Calculator' }
  const first = { role: 'assistant', content: 'First result', data: { actionResult: { success: true } } }
  const second = { role: 'assistant', content: 'Second result', data: { actionResult: { success: false } } }
  expect(mergeMiraVoiceHistory([user, first, user, second], [user, { role: 'assistant', content: 'Done' }, user, { role: 'assistant', content: 'Not open' }]).map(item => item.content))
    .toEqual(['Open Calculator', 'First result', 'Done', 'Open Calculator', 'Second result', 'Not open'])
})

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
