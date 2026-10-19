import { miraAttachmentContext, validMiraAttachments } from './miraAttachments'

// Voice already starts with the visible conversation. Concatenating both copies
// reorders turns and consumes the history budget, dropping the original request.
// Use the spoken chronology, enriching matching turns with actual tool outcomes.
export function mergeMiraVoiceHistory(visible = [], voice = []) {
  if (!voice.length) return visible
  const result = voice.map(message => ({ ...message }))
  let before = visible.length
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].role !== 'user') continue
    const match = visible.findLastIndex((message, index) => index < before && message.role === 'user' && message.content === result[i].content)
    if (match < 0) continue
    const end = visible.findIndex((message, index) => index > match && message.role === 'user')
    const outcomes = visible.slice(match + 1, end < 0 ? visible.length : end).filter(message => message.role === 'assistant' && message.data?.actionResult)
    const next = result.findIndex((message, index) => index > i && message.role === 'user')
    for (const outcome of outcomes) {
      const existing = result.findIndex((message, index) => index > i && (next < 0 || index < next) && message.role === 'assistant' && message.content === outcome.content)
      if (existing >= 0) result[existing] = outcome
      else result.splice(i + 1, 0, outcome)
    }
    before = match
  }
  return result
}

// Bound historical context on both sides of the API. Current input is never truncated.
export function compactMiraHistory(messages = []) {
  const result = []
  let remaining = 16000
  for (const message of messages.slice(-10).reverse()) {
    if (remaining < 200) break
    let content = String(message.data?.message || message.content || '')
    if (message.role === 'user' && validMiraAttachments(message.data?.attachments)) content += miraAttachmentContext(message.data.attachments)
    const outcome = message.data?.actionResult
    if (message.role === 'assistant' && outcome) {
      // Keep execution truth, not entire returned documents or candidate rosters.
      content = `${content.slice(0, 2000)}\nAction outcome: ${JSON.stringify({
        result: { success: outcome.success, uncertain: outcome.uncertain, message: String(outcome.message || '').slice(0, 500), resolved: outcome.resolved, resource: outcome.resource, navigation: outcome.navigation },
        action: message.data.action,
      })}`
    }
    const limit = Math.min(4000, remaining)
    if (content.length > limit) content = content.slice(0, limit - 30) + '\n[Earlier content truncated]'
    result.unshift({ role: message.role, content })
    remaining -= content.length
  }
  return result
}

export function miraChatUseCase(query) {
  // Reading a task or project does not by itself require a reasoning model.
  return /\b(create|assign|send|invite|schedule|plan|design|debug|compare|analy[sz]e|implement)\b|बना|भेज|सौंप|आमंत्रित|योजना|विश्लेषण/i.test(query)
    ? 'mira-actions' : 'mira'
}
