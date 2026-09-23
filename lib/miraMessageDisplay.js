// Reply context stays in the request/history, but is not user-visible prose.
export function miraMessageDisplay(message) {
  const content = message?.content || ''
  if (message?.role !== 'user') return content
  return content.replace(/^Replying to this MIRA response:\s*<quoted-response>[\s\S]*?<\/quoted-response>\s*/, '')
}
