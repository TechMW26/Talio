import { buildSearchQueryVariants, extractSearchSubject } from './miraSearchRelevance'

// Only public query text crosses the provider boundary. This guard is shared by
// typed chat, voice, semantic routing and the low-level provider entrypoint.
export function publicMiraSearchQuery(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (/\b(?:my tasks|attendance|salary|payroll|employee|password|secret|token|api.?key|(?:my|our|previous|older|past|saved) (?:chats?|conversations?))\b|मेरे.*काम|वेतन|हाजिरी|पासवर्ड|पुरानी.*चैट|पिछली.*बात|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{10,}\b|\bBearer\s+\S+|\bsk-[\w-]{10,}/iu.test(text)) return null
  if (/\b(?:my|our)\s+(?:upcoming\s+|missed\s+|unread\s+|pending\s+)?(?:meetings?|emails?|messages?|calls?|calendar|inbox|contacts?|recordings?|transcripts?|tasks?)\b|(?:मेरे|मेरी|हमारे|हमारी).*(?:ईमेल|कॉल|संदेश|मीटिंग|बैठक)|\b(?:api[_-]?key|apikey)[_-][a-z0-9]{12,}/iu.test(text)) return null
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    if (!publicMiraSearchUrl(match[0])) return null
  }
  const spelling = text.replace(/[.?!।]+$/u, '').replace(/double[\s-]+([a-z])/gi, '$1-$1')
  return /^[a-z](?:[\s,-]+[a-z]){2,}$/i.test(spelling) ? spelling.replace(/[^a-z]/gi, '') : text
}

export function publicMiraSearchUrl(value) {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    if (host === 'localhost' || !host.includes('.') || /\.(?:localhost|local|internal|lan)$/i.test(host)
      || /^(?:0|10|127|169\.254|192\.168)\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
      || /^(?:fc|fd|fe80):|^::/.test(host)) return null
    if ([...url.searchParams.keys()].some(key => /^(?:key|api[-_]?key|access[-_]?token|token|auth|authorization|signature|password|secret)$/i.test(key))) return null
    url.hash = ''
    return url.href
  } catch { return null }
}

// Standalone MIRA's retry strategy: preserve the named subject, then recover
// spacing/ASR spelling without another generation. Never use private history.
export function buildMiraSearchQueries(value, fresh = false) {
  const accepted = publicMiraSearchQuery(value)
  if (!accepted) return []
  const text = accepted
    .replace(/^(?:please\s+)?search (?:the )?(?:web|internet)(?: for)?\s*/i, '')
    .replace(/^(?:(?:hey|hi|please|mira|meera|मीरा)[,।!\s]+)+/iu, '')
    .replace(/\byatch\b/gi, 'yacht').replace(/\byaht\b/gi, 'yacht')
  const subject = extractSearchSubject(text)
    .replace(/^(?:mujhe|mere\s+ko)\s+/i, '')
    .replace(/\s+ke\s+baare\s+(?:me|mein)\b[\s\S]*$/i, '')
    .replace(/\s+(?:ke\s+)?(?:current\s+)?(?:verified\s+)?details?\s+batao\b[\s\S]*$/i, '')
    .trim()
  return [...new Set([subject, ...buildSearchQueryVariants(subject, fresh), text])]
    .filter(query => query && publicMiraSearchQuery(query)).slice(0, 3)
}
