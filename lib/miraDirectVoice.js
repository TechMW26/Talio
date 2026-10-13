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

export const MIRA_DIRECT_VOICE_INSTRUCTIONS = `DIRECT TALIO VOICE: DeepSeek generates the reply; ElevenLabs only transcribes and synthesizes audio. Keep the existing Mira personality, emotional cues, feminine self-reference and English/Hindi language contract. HARD OUTPUT LIMIT: at most two short sentences, ideally one, under 60 words. Even for a broad question give its key answer in two sentences; put detailed workplace deliverables in the tool's cards. Include essential safety or uncertainty within that limit. Resolve the request and let the conversation settle: no routine closing offer, follow-up question or new topic. Ask one concise question only if required to proceed. Never force a farewell or end the call merely because an answer is complete. Use expressive tags and the brisk pacing rules, not filler. For tools emit only the tool call, with no spoken preamble; never narrate success before verification. After a tool result, give the verified outcome in at most two sentences without another tool call.`

export const MIRA_DIRECT_VOICE_TOOLS = [
  ['ask_mira', 'Use the authenticated Talio workflow for workplace data, navigation, screen/desktop control, messages, files and actions. Never for casual conversation.'],
  ['search_internet', 'Search public current facts, unfamiliar public terms and requested web research. Never send private workplace information.'],
  ['skip_turn', 'Remain silent for a pause request or no meaningful speech.'],
].map(([name, description]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: {}, additionalProperties: false } } }))
