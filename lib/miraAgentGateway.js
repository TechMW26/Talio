import { createHash } from 'node:crypto'

// Deterministic OpenAI-compatible adapter. DeepSeek remains the only reasoning
// engine, invoked by the authenticated client tool, never a second provider LLM.
export function miraAgentCompletion(messages) {
  if (!Array.isArray(messages) || messages.length > 200) throw new Error('Invalid conversation')
  const last = messages.at(-1)
  if (last?.role === 'tool') {
    const parent = [...messages].reverse().find(message => message.role === 'assistant' && message.tool_calls?.some(call => call.id === last.tool_call_id && call.function?.name === 'ask_mira'))
    if (!parent) throw new Error('Unrecognized tool result')
    const result = JSON.parse(last.content)
    if (typeof result.speech !== 'string' || result.speech.length > 6000) throw new Error('Invalid speech result')
    return { delta: { role: 'assistant', content: result.speech }, finish: 'stop' }
  }
  if (last?.role !== 'user' || typeof last.content !== 'string' || !last.content.trim() || last.content.length > 5000) throw new Error('Expected a final user utterance')
  const turnId = createHash('sha256').update(JSON.stringify(messages)).digest('hex').slice(0, 24)
  return { delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${turnId}`, type: 'function',
    function: { name: 'ask_mira', arguments: JSON.stringify({ message: last.content, utterance_id: turnId }) } }] }, finish: 'tool_calls' }
}

export function miraAgentSSE(completion) {
  const id = `chatcmpl-${Date.now()}`
  const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'talio-mira', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
  return chunk(completion.delta, null) + chunk({}, completion.finish) + 'data: [DONE]\n\n'
}
