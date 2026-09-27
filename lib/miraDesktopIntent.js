import Fuse from 'fuse.js'

const appNames = ['Talio', 'WhatsApp', 'Telegram', 'Signal', 'Slack', 'Outlook', 'Gmail', 'Discord', 'Spotify', 'Notes', 'Calculator', 'Finder', 'TextEdit', 'Chrome', 'Safari', 'Notepad']
const compactName = value => value.normalize('NFKC').toLowerCase().replace(/[\s.-]+/g, '')
const appIndex = new Fuse(appNames.map(name => ({ name, key: compactName(name) })), { keys: ['key'], threshold: 0.3, includeScore: true, ignoreLocation: true })
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1]
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)))
    row = next
  }
  return row[b.length]
}

export function resolveMiraAppName(value) {
  const key = compactName(String(value || '').trim())
  const exact = appNames.find(name => compactName(name) === key)
  if (exact) return exact
  if (['taleo', 'teleo', 'telio', 'टालियो', 'तालियो', 'टैलियो'].includes(key)) return 'Talio'
  if (key.length < 4 || key.length > 20 || !/^[a-z]+$/.test(key)) return null
  const [best, next] = appIndex.search(key)
  return best && editDistance(key, best.item.key) <= (key.length >= 8 ? 2 : 1)
    && (!next || next.score - best.score >= 0.12) ? best.item.name : null
}

// External-app recipients belong to that application, never the HR directory.
export function miraDesktopIntent(message) {
  const text = String(message || '').trim()
  // A cancellation mentioning WhatsApp is not authorization to open it again.
  if (/^(?:(?:uh|um|mira|please)[,!.\s]+)*(?:let['’]?s\s+)?(?:skip|cancel|stop|forget|drop|instead)\b/iu.test(text)) return null
  if (/^(?:please\s+)?(?:explain|what is|how (?:do|does|can|to)|don't|do not|never)\b/iu.test(text)) return null
  const talioOpen = miraOpenAppIntent(text)
  if (talioOpen) return { app: talioOpen, goal: `Open ${talioOpen}` }
  if (!/\b(open|launch|focus|restore|switch|bring|text|message|send|search|find|reply|call|khol|kholo|bhej|bhejo)\b|खोल|भेज|मैसेज|ढूंढ/iu.test(text)) return null
  const app = text.match(/\b(whats\s*app|telegram|signal|slack|outlook|gmail|discord|spotify|calculator|notes|finder|textedit|chrome|safari|notepad)\b/iu)?.[1]
  return app ? { app: /^whats\s*app$/i.test(app) ? 'WhatsApp' : app, goal: text.slice(0, 3000) } : null
}

export function miraOpenAppIntent(goal) {
  const text = String(goal || '').trim().replace(/[.!?।]+$/, '')
    .replace(/^(?:(?:hey\s+)?mira[,\s]+|please\s+|(?:can|could|would) you\s+)+/i, '')
  // Pure launches only: preserve multi-step requests, negations and vendor names.
  const match = text.match(/^(?:open|launch|focus|restore|bring up|switch to)\s*(?:the\s+)?(.+?)(?:\s+(?:app|application))?$/iu)
    || text.match(/^(.+?)(?:\s+(?:app|application))?\s+(?:open(?:\s+(?:karo|kar do|करो|कर दो))?|kholo|khol do|खोलो|खोल दो)$/iu)
  if (!match) return null
  const candidate = match[1].trim()
  if (/\s/.test(candidate) && !/^(?:[a-z][\s.-]+)+[a-z]$/i.test(candidate) && !/^whats\s+app$/i.test(candidate)) return null
  return resolveMiraAppName(candidate)
}

export function miraAppNameFollowup(message, history = []) {
  const last = history.at(-1)
  if (last?.role !== 'assistant' || !/\?|confirm|spell|स्पेल|पुष्टि/i.test(last.content)) return null
  const previous = [...history].reverse().find(item => item.role === 'user')
  const app = miraOpenAppIntent(previous?.content)
  if (!app) return null
  const text = String(message || '').trim().replace(/[.!।]+$/, '')
  const correction = resolveMiraAppName(text)
  const agrees = /^(?:yes|yes please|proceed|go ahead|chaliye|haan|हाँ|हां|चलिए)$/iu.test(text)
  return correction || agrees ? `Open ${correction || app}` : null
}
