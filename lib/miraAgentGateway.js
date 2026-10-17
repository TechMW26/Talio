import { createHash, randomUUID } from 'node:crypto'
import { AI_MODELS } from './ai/models'
import { MIRA_AGENT_SYSTEM_PROMPT } from './miraSystemPrompt'
import { readMiraEvents } from './miraStream'
import { miraVoiceContextPrompt } from './miraVoiceContext'
import { resolveMiraSpokenLanguage } from './miraLanguage'
import { MIRA_DIRECT_VOICE_INSTRUCTIONS } from './miraDirectVoice'

const TOOL_NAMES = new Set(['ask_mira', 'search_internet', 'close_mira', 'skip_turn', 'language_detection'])

export function miraDeepSeekRequest(body, language = 'en', userContext) {
  language = ['en', 'hi'].includes(language) ? language : 'en'
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
  // Only the deterministic English/Hindi controller may change pronunciation.
  // The reasoning model must not switch languages for a name or ASR fragment.
  const tools = (body.tools || []).filter(tool => tool.type === 'function' && TOOL_NAMES.has(tool.function?.name) && tool.function.name !== 'language_detection')
  return {
    // Flash is DeepSeek V4.1's supported API alias. Keep Pro for the existing
    // authenticated action/reasoning flow, not every conversational voice turn.
    model: process.env.DEEPSEEK_VOICE_MODEL || AI_MODELS.PRIMARY,
    messages: [{ role: 'system', content: `${MIRA_AGENT_SYSTEM_PROMPT}\n${miraVoiceContextPrompt(userContext)}\nCURRENT SPEECH LANGUAGE: ${language}. For THIS turn the English/Hindi controller has already resolved the user's language and configured pronunciation. Respond only in ${language === 'hi' ? 'Hindi, writing Hindi words in Devanagari and preserving natural Hinglish terms' : 'English'}. Do not call language_detection or infer a different language from a name, quoted text, a brief acknowledgement or older conversation. Meaningful user switches are handled by the controller before your generation. Never switch to a third language. If a request is unclear, clarify briefly in this selected language.` }, ...messages],
    stream: true, thinking: { type: 'disabled' }, temperature: 0.4, max_tokens: 512,
    ...(tools.length ? { tools, tool_choice: 'auto', parallel_tool_calls: false } : {}),
  }
}

// A tool continuation/retry shares the final real user turn's receipt.
export function miraGatewayTurnKey(body, callId) {
  const users = body.messages.filter(message => message.role === 'user').map(message => message.content)
  return `${callId}:${users.length}:${createHash('sha256').update(users.at(-1) || '').digest('hex')}`
}

export async function streamMiraAgentDeepSeek(body, { signal, language = 'en', userContext, onLanguage, direct = false } = {}) {
  language = ['en', 'hi'].includes(language) ? language : 'en'
  const payload = miraDeepSeekRequest(body, language, userContext)
  if (direct) {
    // Stable leading prompt allows DeepSeek's automatic prefix/KV caching;
    // per-caller reference data stays scoped to its signed voice session.
    payload.messages[0].content += '\n' + MIRA_DIRECT_VOICE_INSTRUCTIONS
    // Hindi uses more tokens per word than English. Enforce concise speech in
    // the prompt/client, not a token cap that can truncate the second sentence.
    payload.max_tokens = 512
  }
  const last = payload.messages.at(-1)
  const selected = resolveMiraSpokenLanguage(last.role === 'user' ? last.content : '', language)
  if (last.role === 'user' && selected !== language && body.tools?.some(tool => tool.type === 'function' && tool.function?.name === 'language_detection')) {
    // A clear language switch needs no reasoning-model round trip. Tell the
    // speech transport first, then the normal tool continuation generates the
    // reply once with the correct pronunciation. No speech/action is invented.
    if (signal?.aborted) throw new Error('Voice turn cancelled')
    await onLanguage?.(selected)
    const event = { id: `mira-language-${randomUUID()}`, object: 'chat.completion.chunk', model: 'talio-mira', choices: [{ index: 0,
      delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${randomUUID()}`, type: 'function', function: { name: 'language_detection', arguments: JSON.stringify({ language: selected, reason: 'Clear user language change between English and Hindi' }) } }] }, finish_reason: 'tool_calls' }] }
    return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`).body
  }
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
