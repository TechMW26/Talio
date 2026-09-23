import { miraMessageDisplay } from '@/lib/miraMessageDisplay'

test('hides reply metadata without modifying stored context', () => {
  const content = 'Replying to this MIRA response:\n<quoted-response>\nHey! Aaj kya plan hai?\n</quoted-response>\n\nBaat chaat'
  const message = { role: 'user', content }
  expect(miraMessageDisplay(message)).toBe('Baat chaat')
  expect(message.content).toBe(content)
})
test('preserves ordinary messages, assistant text and incomplete wrappers', () => {
  for (const content of ['Hello', 'Explain <quoted-response> tags', 'Replying to this MIRA response: unfinished']) {
    expect(miraMessageDisplay({ role: 'user', content })).toBe(content)
  }
  const content = 'Replying to this MIRA response: <quoted-response>Example</quoted-response>Text'
  expect(miraMessageDisplay({ role: 'assistant', content })).toBe(content)
  expect(miraMessageDisplay(undefined)).toBe('')
})
