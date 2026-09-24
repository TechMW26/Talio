// Routing is not authorization. Every emitted action still passes server validation.
const command = /\b(open|navigate|switch to|take me to|go to|create|add|schedule|assign|send|invite|update|edit|delete|remove|approve|reject|cancel|reschedule|mark|complete|upload|download|export|khol|kholo|banao|bana do|bhej|bhejo|kar do)\b|खोल|बना|भेज|सौंप|आमंत्रित|हटा|बदल|कर दो|करो/iu
const explanation = /^(?:please\s+)?(?:explain|what is|what does|how (?:do|does|can|to)|why|translate|summarize|write (?:a )?(?:guide|example)|don't|do not|never)\b|^(?:कैसे|क्यों|मत )/iu
const newQuestion = /\?|\b(weather|news|explain|what|why|how|tell me|show me)\b/iu

export function isMiraDecisionRequest(message, history = []) {
  const text = String(message || '').trim()
  if (explanation.test(text)) return false
  if (command.test(text)) return true
  const recent = history.slice(-4)
  const last = recent.at(-1)
  // Only continue a request when MIRA just asked for details, not after success.
  if (last?.role !== 'assistant' || !/[?？]/u.test(last.content || '') || /"success"\s*:\s*true/.test(last.content || '') || newQuestion.test(text)) return false
  return recent.some(item => item.role === 'user' && command.test(item.content || '') && !explanation.test(item.content || ''))
}
