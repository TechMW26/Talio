import { miraAttachmentContext, validMiraAttachments } from './miraAttachments'

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
