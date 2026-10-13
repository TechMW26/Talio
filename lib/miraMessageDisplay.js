// Reply context stays in the request/history, but is not user-visible prose.
export function miraPlainCaption(content = '') {
  return String(content).replace(/```[\s\S]*?```/g, 'Code is available in the chat.')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s+/gm, '')
}
export function miraMessageDisplay(message) {
  const content = message?.content || ''
  if (message?.role !== 'user') return content
  return content.replace(/^Replying to this MIRA response:\s*<quoted-response>[\s\S]*?<\/quoted-response>\s*/, '')
}
// These are synthesis controls, not transcript prose. Preserve user text and
// normal bracketed values; clean only the native agent's saved spoken captions.
export function miraVoiceTranscript(content = '') {
  return String(content).replace(/\[(?:laughs?|laughing|chuckles?|sighs?|excited|reassuring|empathetic|warm|confident|neutral|fast|quickly|slow|attentive|curious|whispers?)\]/gi, '').replace(/\s+/g, ' ').trim()
}
