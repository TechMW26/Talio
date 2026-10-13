import { createHash } from 'node:crypto'
import { AI_MODELS } from './ai/models'
import { MIRA_AGENT_SYSTEM_PROMPT } from './miraSystemPrompt'
import { readMiraEvents } from './miraStream'

const TOOL_NAMES = new Set(['ask_mira', 'search_internet', 'close_mira', 'skip_turn', 'language_detection'])

export function miraDeepSeekRequest(body, language = 'en') {
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 200) throw new Error('Invalid conversation')
  const calls = new Set()
  const messages = body.messages.filter(message => message.role !== 'system').map(message => {
    if (!['user', 'assistant', 'tool'].includes(message.role)) throw new Error('Invalid message role')
    if (message.content != null && (typeof message.content !== 'string' || message.content.length > 12000)) throw new Error('Invalid message')
    const next = { role: message.role, content: message.content || '' }
    if (message.role === 'assistant' && message.tool_calls) {
      next.tool_calls = message.tool_calls.map(call => {
        if (!TOOL_NAMES.has(call.function?.name) || typeof call.id !== 'string' || typeof call.function.arguments !== 'string') throw new Error('Invalid tool call')
        calls.add(call.id)
        return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } }
      })
    }
    if (message.role === 'tool') {
      if (!calls.has(message.tool_call_id)) throw new Error('Unrecognized tool result')
      next.tool_call_id = message.tool_call_id
    }
    return next
  })
  if (!messages.some(message => message.role === 'user') || !['user', 'tool'].includes(messages.at(-1)?.role)) throw new Error('Expected user speech or tool result')
  const tools = (body.tools || []).filter(tool => tool.type === 'function' && TOOL_NAMES.has(tool.function?.name))
  return {
    model: process.env.DEEPSEEK_VOICE_MODEL || process.env.DEEPSEEK_PRO_MODEL || AI_MODELS.PRO,
    messages: [{ role: 'system', content: `${MIRA_AGENT_SYSTEM_PROMPT}\nCURRENT SPEECH LANGUAGE: ${language}. Start in this saved account language. Follow the user's newest clear spoken language and respond only in it until they change it. REQUIRED BEFORE SPEAKING: if their current language differs from ${language}, call language_detection with its language code first, with no spoken text in that tool-call response. This configures pronunciation and saves their preference; simply translating your reply is insufficient. After the tool succeeds, reply normally in that language. Names, quotes and isolated borrowed words do not change the language.` }, ...messages],
    stream: true, thinking: { type: 'disabled' }, temperature: 0.2, max_tokens: 512,
    ...(tools.length ? { tools, tool_choice: 'auto', parallel_tool_calls: false } : {}),
  }
}

// A tool continuation/retry shares the final real user turn's receipt.
export function miraGatewayTurnKey(body, callId) {
  const users = body.messages.filter(message => message.role === 'user').map(message => message.content)
  return `${callId}:${users.length}:${createHash('sha256').update(users.at(-1) || '').digest('hex')}`
}

export async function streamMiraAgentDeepSeek(body, { signal, language = 'en', onLanguage } = {}) {
  const payload = miraDeepSeekRequest(body, language)
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('Voice model unavailable')
  const abort = new AbortController()
  const cancel = () => abort.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) abort.abort()
  const timer = setTimeout(cancel, 55000)
  const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
  let response
  try {
    response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: abort.signal, cache: 'no-store',
    })
    if (!response.ok || !response.body) throw new Error('Voice model unavailable')
  } catch (error) { cleanup(); throw error }
  const encoder = new TextEncoder(), toolCalls = new Map()
  return new ReadableStream({
    async start(controller) {
      let finished = false, finalChunk
      try {
        await readMiraEvents(response.body, event => {
          if (event.error) throw new Error('Voice generation interrupted')
          const choice = event.choices?.[0]
          if (!choice) return
          const delta = {}
          for (const key of ['role', 'content', 'tool_calls']) if (choice.delta?.[key] !== undefined) delta[key] = choice.delta[key]
          for (const call of delta.tool_calls || []) {
            const saved = toolCalls.get(call.index) || { name: '', arguments: '' }
            saved.name += call.function?.name || ''; saved.arguments += call.function?.arguments || ''
            toolCalls.set(call.index, saved)
          }
          if (choice.finish_reason) {
            if (!['stop', 'tool_calls'].includes(choice.finish_reason)) throw new Error('Voice reply incomplete')
            finished = true
          }
          // Reasoning traces and upstream metadata never reach speech or captions.
          const chunk = encoder.encode(`data: ${JSON.stringify({ id: event.id, object: 'chat.completion.chunk', model: 'talio-mira', choices: [{ index: 0, delta, finish_reason: choice.finish_reason || null }] })}\n\n`)
          if (choice.finish_reason) finalChunk = chunk
          else controller.enqueue(chunk)
        })
        if (!finished) throw new Error('Voice reply incomplete')
        for (const call of toolCalls.values()) {
          if (call.name === 'language_detection' && onLanguage) {
            let selected
            try { selected = JSON.parse(call.arguments).language } catch { continue }
            await onLanguage(selected)
          }
        }
        controller.enqueue(finalChunk)
        controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close()
      } catch { controller.error(new Error('Voice generation interrupted')) }
      finally { cleanup() }
    },
    cancel() { cancel(); cleanup() },
  })
}
