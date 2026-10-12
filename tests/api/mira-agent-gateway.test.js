import { miraAgentCompletion, miraAgentSSE } from '@/lib/miraAgentGateway'

test('routes an exact final utterance once without invoking another LLM', () => {
  const messages = [{ role: 'user', content: 'Send a Talio DM to my manager' }]
  const completion = miraAgentCompletion(messages)
  const call = completion.delta.tool_calls[0]
  expect(call.function.name).toBe('ask_mira')
  expect(JSON.parse(call.function.arguments).message).toBe(messages[0].content)
  expect(miraAgentCompletion(messages)).toEqual(completion)
  expect(miraAgentSSE(completion)).toContain('"finish_reason":"tool_calls"')
  expect(miraAgentSSE(completion)).toMatch(/data: \[DONE\]\n\n$/)
})
test('only speaks a verified matching client tool result', () => {
  const messages = [{ role: 'user', content: 'Hi' }, { role: 'assistant', tool_calls: [{ id: 'call_1', function: { name: 'ask_mira' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: JSON.stringify({ speech: 'Hello.' }) }]
  expect(miraAgentCompletion(messages)).toEqual({ delta: { role: 'assistant', content: 'Hello.' }, finish: 'stop' })
  expect(() => miraAgentCompletion([{ role: 'tool', tool_call_id: 'bad', content: '{"speech":"Done"}' }])).toThrow('Unrecognized')
})
test('rejects malformed and unbounded conversations', () => {
  for (const messages of [null, [], [{ role: 'user', content: 'x'.repeat(5001) }], [{ role: 'assistant', content: 'execute' }]]) expect(() => miraAgentCompletion(messages)).toThrow()
})
