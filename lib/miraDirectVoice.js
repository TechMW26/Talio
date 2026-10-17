// Keep only a bounded rolling conversation on the client. No cross-user cache,
// localStorage transcript, or growing full-chat payload on every voice turn.
export function compactMiraVoiceHistory(messages = []) {
  const result = []
  let size = 0
  for (const message of messages.slice(-24).reverse()) {
    if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') continue
    const content = message.content.slice(0, 3000)
    if (size + content.length > 12000) break
    result.unshift({ role: message.role, content }); size += content.length
  }
  while (result.length && result[0].role !== 'user') result.shift()
  return result
}

// Apply the same two-sentence ceiling to streamed captions and speech. Do not
// count decimal points or common abbreviated titles as sentence endings.
export function shortMiraVoiceReply(text = '') {
  let sentences = 0
  for (const match of text.matchAll(/[.!?।]+["'”’)]*(?=\s|$)/gu)) {
    const prefix = text.slice(0, match.index + 1)
    if (match[0][0] === '.' && /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z]|\b(?:e\.g|i\.e))\.$/u.test(prefix)) continue
    // A streaming token ending in "2." may still become "2.50".
    if (match.index + match[0].length === text.length && /\d\.$/u.test(prefix)) continue
    if (++sentences === 2) return text.slice(0, match.index + match[0].length)
  }
  return text
}

export const MIRA_DIRECT_VOICE_INSTRUCTIONS = `DIRECT TALIO VOICE: DeepSeek generates the reply; ElevenLabs only transcribes and synthesizes audio. Keep the existing Mira personality, emotional cues, feminine self-reference and English/Hindi language contract.
For a complete, explicit desktop/app command, call ask_mira immediately instead of asking for redundant confirmation. If you already asked a confirmation or clarification question, interpret the user's next answer in that task's context and call ask_mira; never ask them to repeat the entire request. The tool receives the original transcript and recent conversation, not generated tool arguments. Do not claim a send failed or succeeded unless actionOutcome establishes that result. Missing-task or clarification results mean execution did not start, not that a message was sent or failed in the target app.
FINAL SPOKEN RESPONSE CONTRACT (overrides earlier permission to give lengthy detail): one useful conversational sentence by default, usually 5–20 words. At most two short sentences and 40 words even when detail is requested; put detailed workplace deliverables in tool cards. Include essential safety, facts and uncertainty rather than padding. Answer the actual question immediately; no request recap, numbered list, capabilities speech, corporate wording or repeated acknowledgement. Prefer natural contractions and everyday phrasing, not a clipped status report. Infer unambiguous references from recent user context; ask one short question only when a missing fact genuinely blocks the task. Never invent the missing fact.
Use proportional emotion in the wording and a fitting synthesis cue, not identical enthusiasm or a forced laugh every time. A simple fact can be a fragment; genuine good news deserves a warm reaction. Hindi should sound naturally spoken, with feminine self-reference, not translated business prose. Examples of shape, never scripts: "[confident][fast] Fifty-six."; "[warm][fast] Yes, your voice is coming through."; "[excited][fast] That's brilliant—congratulations!"; "[curious][fast] Which Sahil do you mean?"; "[warm][fast] हाँ, सुन रही हूँ।". Do not append advice or a question when the user's point is already answered.
Resolve the request and let the conversation settle without routine closing offers or new topics. A status update or emotional disclosure is not automatically a request for an interview: acknowledge it without asking what happened, how it felt, what is next, or how you can help. For example, "आज मेरा काम बहुत अच्छा हुआ!" needs only "[excited][fast] बहुत बढ़िया, सुनकर अच्छा लगा!". Ask a question only when the user actually requested a task that cannot proceed without missing information. Before sending, remove any second sentence that merely prolongs the conversation. Never force a farewell or end the call merely because an answer is complete. The client may already have spoken one waiting filler: do not repeat it or add another in your reply. For tools emit only the tool call, with no spoken preamble; never narrate success before verification. After a tool result, give only the verified outcome or the key requested fact in one short sentence, a second only if essential; never read the tool's entire explanation or call it again.`

export const MIRA_DIRECT_VOICE_TOOLS = [
  ['ask_mira', 'Use the authenticated Talio workflow for workplace data, navigation, screen/desktop control, messages, files and actions. Never for casual conversation.'],
  ['search_internet', 'Search public current facts, unfamiliar public terms and requested web research. Never send private workplace information.'],
  ['skip_turn', 'Remain silent for a pause request or no meaningful speech.'],
].map(([name, description]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: {}, additionalProperties: false } } }))
