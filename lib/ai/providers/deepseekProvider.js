import { AI_MODELS, resolveUseCase } from '../models.js'
import { readMiraEvents } from '../../miraStream.js'

export function getDeepSeekAvailability() {
  return {
    configured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
    textModel: process.env.DEEPSEEK_FLASH_MODEL || AI_MODELS.PRIMARY,
    proModel: process.env.DEEPSEEK_PRO_MODEL || AI_MODELS.PRO,
  }
}

function requestConfig(prompt, systemInstruction, options) {
  const entry = resolveUseCase(options.useCase)
  if (options.useCase === 'vision') throw new Error('Use the vision API for image inputs')
  const fast = process.env.DEEPSEEK_FLASH_MODEL || AI_MODELS.PRIMARY
  const pro = process.env.DEEPSEEK_PRO_MODEL || AI_MODELS.PRO
  const model = options.model || (entry.thinking ? pro : fast)
  if (!/^deepseek-[a-z0-9.-]+$/i.test(model)) throw new Error('Text model must be a DeepSeek model')
  const models = [...new Set([model, ...(!options.model && entry.thinking ? [fast] : [])])]
  const messages = []
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction })
  messages.push({ role: 'user', content: prompt })
  return { models, body: {
    messages,
    thinking: { type: (options.thinking ?? entry.thinking) ? 'enabled' : 'disabled' },
    ...((options.thinking ?? entry.thinking) ? { reasoning_effort: 'high' } : {}),
    ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
  } }
}

// Deadline covers headers AND consumption, including a stalled stream.
async function request(prompt, systemInstruction, options, stream) {
  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) {
    const error = new Error('DeepSeek is not configured — DEEPSEEK_API_KEY is missing')
    error.errorClass = 'unconfigured'
    throw error
  }
  const { models, body } = requestConfig(prompt, systemInstruction, options)
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  const timer = setTimeout(abort, Math.max(1000, Math.min(60000, Number(options.timeoutMs) || Number(process.env.DEEPSEEK_TIMEOUT_MS) || 60000)))
  try {
    for (const model of models) {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ ...body, model, stream }),
      })
      if (response.status === 404 && model !== models.at(-1)) { await response.body?.cancel(); continue }
      if (!response.ok) {
        await response.body?.cancel()
        // Provider bodies can contain prompts or credentials; never log them.
        const error = new Error(`DeepSeek API error ${response.status}`)
        error.status = response.status
        error.errorClass = response.status === 429 ? 'rate_limit' : response.status >= 500 ? 'server' : 'client'
        throw error
      }
      if (!stream) {
        const result = await response.json()
        if (result.choices?.[0]?.finish_reason === 'length') throw new Error('DeepSeek response exceeded its token limit')
        const text = result.choices?.[0]?.message?.content
        if (!text?.trim()) throw new Error('DeepSeek returned an empty response')
        return text.trim()
      }
      if (!response.body) throw new Error('DeepSeek stream unavailable')
      let text = '', finished = false
      await readMiraEvents(response.body, event => {
        if (event.error) throw new Error('DeepSeek stream failed')
        const choice = event.choices?.[0]
        if (choice?.finish_reason === 'length') throw new Error('DeepSeek response exceeded its token limit')
        if (choice?.finish_reason === 'stop') finished = true
        const delta = choice?.delta?.content
        // Do not expose reasoning_content to chat or TTS.
        if (typeof delta === 'string') { text += delta; options.onDelta?.(text) }
      })
      if (!finished || !text.trim()) throw new Error('DeepSeek stream ended before completion')
      return text
    }
    throw new Error('DeepSeek models unavailable')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

export function generateDeepSeekContent(prompt, systemInstruction = '', options = {}) {
  return request(prompt, systemInstruction, options, false)
}
export function streamDeepSeekContent(prompt, systemInstruction = '', options = {}) {
  // Never retry a stream after exposing a partial response.
  return request(prompt, systemInstruction, options, true)
}
