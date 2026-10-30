import { miraNeedsDeliberation } from '@/lib/miraReasoningPolicy'
import { miraDeepSeekRequest } from '@/lib/miraAgentGateway'
const request = content => miraDeepSeekRequest({ messages: [{ role: 'user', content }] })
test.each([
  'Start at 9, double it, subtract 4, triple it and add 2.',
  'Start at seven, double it, subtract five, triple it and add four.',
  'Occupied 09:00-09:40 and 10:00-10:30. Find a 30 minute slot.',
  '7 में 3 जोड़ फिर 2 से गुणा करें।',
])('numerical chains deliberate without exposing reasoning: %s', content => {
  expect(miraNeedsDeliberation([{ role: 'user', content }])).toBe(true)
  expect(request(content)).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'low', stream: true, max_tokens: 2048 })
})
test.each(['Hi Mira', 'Open Calculator', 'What is a rainbow?', 'Play music', 'What is 7 times 8?'])('ordinary turns keep instant streaming: %s', content => {
  expect(request(content)).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: 512 })
})
