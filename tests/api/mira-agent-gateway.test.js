import { miraDeepSeekRequest, miraGatewayTurnKey, streamMiraAgentDeepSeek } from '@/lib/miraAgentGateway'
import { resolveMiraSpokenLanguage } from '@/lib/miraLanguage'

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
test('narrows provider language tools to English and Hindi without mutating their schema', () => {
  const tool = { type: 'function', function: { name: 'language_detection', parameters: { type: 'object', properties: { language: { type: 'string', enum: ['en', 'hi', 'es'] }, reason: { type: 'string' } }, required: ['language'] } } }
  const request = miraDeepSeekRequest({ ...body, tools: [tool] }, 'it')
  expect(request.messages[0].content).toContain('CURRENT SPEECH LANGUAGE: en')
  expect(request.tools[0].function.parameters.properties.language.enum).toEqual(['en', 'hi'])
  expect(request.tools[0].function.parameters.properties.reason).toEqual({ type: 'string' })
  expect(tool.function.parameters.properties.language.enum).toEqual(['en', 'hi', 'es'])
})
test.each([
  ['हाँ मीरा तुम कैसी हो?', 'en', 'hi'], ['Can we switch back to English?', 'hi', 'en'],
  ['Hindi mein bolo', 'en', 'hi'], ['How are you today?', 'hi', 'en'],
  ['मुझे आज प्रमोशन मिला!', 'en', 'hi'], ['Sameer', 'hi', 'hi'], ['S-A-H-I-L', 'hi', 'hi'],
  ['Okay', 'hi', 'hi'], ['Com’è che sì?', 'en', 'en'], ['Please speak in Italian', 'hi', 'hi'],
  ['माझ्या बैठका दाखवा', 'en', 'en'], ['"हाँ मीरा तुम कैसी हो?"', 'en', 'en'],
])('resolves only clear English/Hindi switches: %s', (text, current, expected) => {
  expect(resolveMiraSpokenLanguage(text, current)).toBe(expected)
})
test('a clear language switch avoids an entire DeepSeek generation before pronunciation changes', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch')
  const onLanguage = jest.fn()
  try {
    const stream = await streamMiraAgentDeepSeek({ messages: [{ role: 'user', content: 'हाँ मीरा तुम कैसी हो?' }], tools: [{ type: 'function', function: { name: 'language_detection' } }] }, { language: 'en', onLanguage })
    const text = await new Response(stream).text()
    expect(text).toContain('language_detection')
    expect(text).toContain('\\"hi\\"')
    expect(onLanguage).toHaveBeenCalledWith('hi')
    expect(fetchSpy).not.toHaveBeenCalled()
  } finally { fetchSpy.mockRestore() }
})
test('delivers the first speech chunk before the model finishes generating', async () => {
  process.env.DEEPSEEK_API_KEY = 'test-only'
  let upstream
  const bodyStream = new ReadableStream({ start(controller) { upstream = controller } })
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(bodyStream))
  const event = value => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
  try {
    const stream = await streamMiraAgentDeepSeek(body)
    const reader = stream.getReader()
    upstream.enqueue(event({ choices: [{ delta: { content: '[excited] Wonderful!' } }] }))
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('[excited] Wonderful!')
    upstream.enqueue(event({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
    upstream.close()
    while (!(await reader.read()).done) {}
  } finally { fetchSpy.mockRestore(); delete process.env.DEEPSEEK_API_KEY }
})
test('invalid messages and unmatched or unknown tool results fail before provider use', () => {
  for (const messages of [[], null, [{ role: 'tool', tool_call_id: 'unknown', content: 'done' }], [{ role: 'user', content: 'x'.repeat(12001) }]]) expect(() => miraDeepSeekRequest({ messages })).toThrow()
  expect(miraDeepSeekRequest({ ...body, tools: [{ type: 'function', function: { name: 'delete_everything' } }] }).tools).toBeUndefined()
})
test('stream forwards text and persists a language switch while withholding reasoning', async () => {
  process.env.DEEPSEEK_API_KEY = 'test-only'
  const events = [
    { choices: [{ delta: { reasoning_content: 'private reasoning', content: '[reass' } }] },
    { choices: [{ delta: { content: 'uring] नमस्ते' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'language_detection', arguments: '{"language":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] }, finish_reason: 'tool_calls' }] },
  ]
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'))
  const onLanguage = jest.fn()
  try {
    const stream = await streamMiraAgentDeepSeek(body, { onLanguage })
    const text = await new Response(stream).text()
    expect(text).toContain('नमस्ते')
    const spoken = text.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)).choices[0].delta.content || '').join('')
    expect(spoken).toBe('[reassuring] नमस्ते')
    expect(text).not.toContain('private reasoning')
    expect(text).toMatch(/data: \[DONE\]\n\n$/)
    expect(onLanguage).toHaveBeenCalledWith('hi')
  } finally { fetchSpy.mockRestore(); delete process.env.DEEPSEEK_API_KEY }
})
