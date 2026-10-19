import Fuse from 'fuse.js'

const appNames = ['Talio', 'WhatsApp', 'Telegram', 'Signal', 'Slack', 'Outlook', 'Gmail', 'Discord', 'Spotify', 'YouTube Music', 'Notes', 'Calculator', 'Finder', 'TextEdit', 'Chrome', 'Safari', 'Notepad', 'System Settings', 'Settings', 'Photo Booth', 'Camera']
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
  // Explicit device commands use the current host, not the HR action catalog.
  // Leave informational/negative requests to chat without starting a session.
  if (/\b(?:don't|do not|never)\b|मत|नहीं/iu.test(text)) {
    // A separate preservation constraint is not a cancellation of the earlier
    // explicit command. Route only from that first clause and retain the entire
    // instruction for both planners; never route from a later negated app name.
    // A later cancellation still overrides an earlier launch. Only the narrow
    // content-preservation case can reach the deterministic activation path.
    if (/\b(?:don't|do not|never)\s+(?:open|launch|focus|restore|switch|bring|do|proceed|continue|start|act|execute)\b|\b(?:cancel|skip|stop|forget)\b|मत\s*(?:खोल|कर|चला)|(?:खोल|कर|चला)\S*\s+मत/iu.test(text)) return null
    const firstClause = text.split(/[.;।]|\s+but\s+/iu)[0].trim()
    const firstIntent = firstClause !== text && !/\b(?:don't|do not|never)\b|मत|नहीं/iu.test(firstClause)
      ? miraDesktopIntent(firstClause) : null
    return firstIntent ? { ...firstIntent, goal: text.slice(0, 3000) } : null
  }
  const deviceTarget = /\b(?:brightness|volume|sound|mute|unmute|camera|webcam|selfie|system settings|photo booth)\b|ब्राइटनेस|वॉल्यूम|आवाज|आवाज़|कैमरा|सेल्फी/iu.test(text)
  const deviceAction = /\b(?:turn|set|increase|decrease|reduce|lower|raise|adjust|mute|unmute|open|take|capture|enable|disable|karo|kar|do|kam|badhao|kholo)\b|कर|कम|बढ़ा|खोल|ले लो|लीजिए/iu.test(text)
  if (deviceTarget && deviceAction && !/^(?:what|why|how|explain)\b/iu.test(text)) return { goal: text.slice(0, 3000) }
  const talioOpen = miraOpenAppIntent(text)
  if (talioOpen) return { app: talioOpen, goal: `Open ${talioOpen}` }
  if (!/\b(open|launch|focus|restore|switch|bring|play|pause|resume|text|message|send|search|find|reply|call|khol|kholo|bhej|bhejo|bajao|chalao)\b|खोल|भेज|मैसेज|ढूंढ|बजाओ|बजाइए|चलाओ|चला दो/iu.test(text)) return null
  const app = text.match(/\b(youtube\s*music|whats\s*app|telegram|signal|slack|outlook|gmail|discord|spotify|calculator|notes|finder|textedit|chrome|safari|notepad)\b/iu)?.[1]
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
  if (/\s/.test(candidate) && !appNames.some(name => compactName(name) === compactName(candidate)) && !/^(?:[a-z][\s.-]+)+[a-z]$/i.test(candidate) && !/^whats\s+app$/i.test(candidate)) return null
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

// Only a pure app launch is safe to repeat without duplicate-send verification.
// Match a whole follow-up, not a quoted "retry" inside a new message request.
export function miraAppRetryIntent(message, taskBank) {
  const task = taskBank?.tasks?.find(item => item.status !== 'completed')
  if (task?.action?.type !== 'desktop_task') return null
  const app = miraOpenAppIntent(task.request)
  if (!app) return null
  const text = String(message || '').trim().replace(/[.!।]+$/, '')
  const retry = /^(?:(?:yes|yeah|okay|ok|please|जी|हाँ|हां)[,\s]+)*(?:retry|try again|try once more|go ahead|yes,? please|open (?:it )?again|reopen(?: it)?|कोशिश कीजिए|कोशिश करो|फिर से खोलो|दोबारा खोलो)$/iu.test(text)
    || /^(?:(?:it |the app )?(?:has not|hasn't|did not|didn't|is not|isn't) open(?:ed)?[,.!\s]+)(?:please )?(?:try again|open (?:it )?(?:again|freshly)|reopen(?: it)?)$/iu.test(text)
    || /^(?:नहीं खुला(?: है)?|अभी नहीं खुला)[,।\s]+(?:freshly open करो|फिर से खोलो|दोबारा खोलो|कोशिश कीजिए)$/iu.test(text)
  return retry ? `Open ${app}` : null
}
