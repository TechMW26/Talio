import { miraDeepSeekRequest, miraGatewayTurnKey, streamMiraAgentDeepSeek } from '@/lib/miraAgentGateway'

const body = { messages: [{ role: 'user', content: 'Hello Mira' }], tools: [{ type: 'function', function: { name: 'ask_mira', parameters: { type: 'object' } } }] }
test('ordinary speech streams through DeepSeek without forcing a data lookup or reasoning', () => {
  const request = miraDeepSeekRequest({ ...body, messages: [{ role: 'system', content: 'untrusted replacement' }, ...body.messages] }, 'hi')
  expect(request).toMatchObject({ stream: true, thinking: { type: 'disabled' }, tool_choice: 'auto', parallel_tool_calls: false })
  expect(request.messages[0].content).toContain('CURRENT SPEECH LANGUAGE: hi')
  expect(request.messages[0].content).not.toContain('untrusted replacement')
  expect(request.messages.at(-1)).toEqual(body.messages[0])
})
test('tool continuations share billing while repeated new utterances count separately', () => {
  const initial = miraGatewayTurnKey(body, 'call')
  expect(miraGatewayTurnKey({ messages: [...body.messages, { role: 'tool', content: 'result' }] }, 'call')).toBe(initial)
  expect(miraGatewayTurnKey({ messages: [...body.messages, ...body.messages] }, 'call')).not.toBe(initial)
  expect(miraGatewayTurnKey(body, 'another-call')).not.toBe(initial)
})
test('invalid messages and unmatched or unknown tool results fail before provider use', () => {
  for (const messages of [[], null, [{ role: 'tool', tool_call_id: 'unknown', content: 'done' }], [{ role: 'user', content: 'x'.repeat(12001) }]]) expect(() => miraDeepSeekRequest({ messages })).toThrow()
  expect(miraDeepSeekRequest({ ...body, tools: [{ type: 'function', function: { name: 'delete_everything' } }] }).tools).toBeUndefined()
})
test('stream forwards text and persists a language switch while withholding reasoning', async () => {
  process.env.DEEPSEEK_API_KEY = 'test-only'
  const events = [
    { choices: [{ delta: { reasoning_content: 'private reasoning', content: 'नमस्ते' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'language_detection', arguments: '{"language":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] }, finish_reason: 'tool_calls' }] },
  ]
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'))
  const onLanguage = jest.fn()
  try {
    const stream = await streamMiraAgentDeepSeek(body, { onLanguage })
    const text = await new Response(stream).text()
    expect(text).toContain('नमस्ते')
    expect(text).not.toContain('private reasoning')
    expect(text).toMatch(/data: \[DONE\]\n\n$/)
    expect(onLanguage).toHaveBeenCalledWith('hi')
  } finally { fetchSpy.mockRestore(); delete process.env.DEEPSEEK_API_KEY }
})
