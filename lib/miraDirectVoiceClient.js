import { readMiraEvents } from './miraStream'
import { shortMiraVoiceReply } from './miraDirectVoice'

// Execute only the accepted transcript, never model-authored tool parameters.
export async function generateMiraDirectVoice({ config, messages, turn, signal, onText, onLanguage, onTokens, onClose, execute, getCameraContext }) {
  const token = localStorage.getItem('token') || ''
  let conversation = messages
  for (let step = 0; step < 2; step++) {
    const response = await fetch('/api/ai/mira-voice/reply', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bridgeCredential: config.bridgeCredential, messages: conversation, turn, cameraContext: getCameraContext?.() }), signal })
    if (!response.ok) { const error = new Error((await response.json()).message || 'Voice reply unavailable.'); error.status = response.status; throw error }
    onLanguage?.(response.headers.get('X-Mira-Language') || config.language)
    const balance = response.headers.get('X-Mira-Balance')
    if (balance) { try { onTokens?.(JSON.parse(balance)) } catch { /* A balance hint must not interrupt speech. */ } }
    let text = '', finished = false
    const calls = new Map()
    await readMiraEvents(response.body, event => {
      signal.throwIfAborted()
      const choice = event.choices?.[0]
      if (!choice) return
      for (const part of choice.delta?.tool_calls || []) {
        const call = calls.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } }
        if (part.id) call.id = part.id
        call.function.name += part.function?.name || ''
        call.function.arguments += part.function?.arguments || ''
        calls.set(part.index, call)
      }
      if (choice.delta?.content && !calls.size) { text = shortMiraVoiceReply(text + choice.delta.content); onText(text) }
      if (['stop', 'tool_calls'].includes(choice.finish_reason)) finished = true
    })
    if (!finished) throw new Error('Voice reply interrupted.')
    if (!calls.size) return text
    if (step || calls.size !== 1 || text.trim()) throw new Error('Mira could not safely complete this voice request.')
    const call = [...calls.values()][0]
    if (call.function.name === 'skip_turn') return ''
    if (call.function.name === 'close_mira') { onClose?.(); return '' }
    if (!['ask_mira', 'search_internet', 'view_camera', 'close_camera'].includes(call.function.name)) throw new Error('Unsupported voice action.')
    const result = await execute(call.function.name)
    signal.throwIfAborted()
    conversation = [...messages, { role: 'assistant', content: '', tool_calls: [call] }, { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 10000) }]
  }
  throw new Error('Voice reply incomplete.')
}
