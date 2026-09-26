// Speech is a separate presentation channel; never modify the displayed answer.
export function naturalMiraSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, ' ')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, ' ')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|in|dev|ai|co|app|edu|gov)(?:\/[^\s]*)?/gi, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s*(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/[*#_>|~]/g, '')
    .replace(/\s+([,.!?।])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/\s+/g, ' ').trim()
}

export function miraSpeechSummary(text) {
  const clean = naturalMiraSpeech(text)
  // Defensive fallback for direct database/action responses and older servers.
  // Derive speech from the authoritative visible reply, not a second answer.
  const sentences = clean.match(/.+?(?:[.!?।]+(?=\s|$)|$)/gu) || []
  let summary = ''
  for (const sentence of sentences.slice(0, 2)) {
    if ((summary + sentence).length > 600) break
    summary += sentence
  }
  return summary.trim() || (clean.length <= 600 ? clean : '')
}

export function miraOutputModeInstructions(mode) {
  const firstSentence = mode === 'voice' ? 'For low-latency speech, make the first sentence a concise, useful answer (ideally 8–16 words), then add essential detail. Never use filler acknowledgments or imply unverified completion. ' : ''
  return firstSentence + (mode === 'voice'
    ? `This is a spoken conversation. Return JSON with "message", cards, suggestedQuestions and optional action. Do not generate a separate speech answer: audio is derived from the final visible message after execution. Start message with one or two complete conversational sentences in the user's language. State the key answer, necessary warning or one clarification. Use ordinary punctuation for pauses. Place supporting links, code and detailed deliverables later in message or cards. Never claim an action succeeded before execution. Do not include a closing offer unless necessary.`
    : `This is typed chat. Give the detail needed to fulfill the request, including useful explanations, links, lists or code. Do not force a short voice-style summary or omit requested details. Avoid filler and repetition.`)
}
