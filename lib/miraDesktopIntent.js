// External-app recipients belong to that application, never the HR directory.
export function miraDesktopIntent(message) {
  const text = String(message || '').trim()
  // A cancellation mentioning WhatsApp is not authorization to open it again.
  if (/^(?:(?:uh|um|mira|please)[,!.\s]+)*(?:let['’]?s\s+)?(?:skip|cancel|stop|forget|drop|instead)\b/iu.test(text)) return null
  if (/^(?:please\s+)?(?:explain|what is|how (?:do|does|can|to)|don't|do not|never)\b/iu.test(text)) return null
  if (!/\b(open|launch|focus|switch|bring|text|message|send|search|find|reply|call|khol|kholo|bhej|bhejo)\b|खोल|भेज|मैसेज|ढूंढ/iu.test(text)) return null
  const app = text.match(/\b(whats\s*app|telegram|signal|slack|outlook|gmail|discord|spotify|calculator)\b/iu)?.[1]
  return app ? { app: /^whats\s*app$/i.test(app) ? 'WhatsApp' : app, goal: text.slice(0, 3000) } : null
}

export function miraOpenAppIntent(goal) {
  const match = String(goal || '').trim().match(/^(?:please\s+)?(?:open|launch|focus|bring up|switch to)\s+(?:the\s+)?(whats\s*app|telegram|signal|slack|outlook|gmail|discord|spotify|notes|calculator)(?:\s+(?:app|application))?[.!]?$/iu)
  return match ? (/^whats\s*app$/i.test(match[1]) ? 'WhatsApp' : match[1]) : null
}
