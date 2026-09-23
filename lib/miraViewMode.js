// Complete UI commands only; do not match quoted text or general page navigation.
export function matchMiraViewMode(value) {
  const text = String(value || '').normalize('NFKC').toLowerCase().trim()
    .replace(/^(?:hey\s+)?mira[,\s]+/u, '').replace(/^please\s+/u, '')
    .replace(/[.!?।]+$/u, '').trim()
  if (/^(?:(?:open|show|restore|expand|switch to|go to|go back to|come back to|bring back)\s+)(?:the\s+)?(?:chat|chatbox|chat box)(?:\s+view)?$/.test(text) || /^(?:चैट|चैटबॉक्स) (?:खोलो|खोल दो|दिखाओ)$/.test(text)) return 'chat'
  if (/^(?:open|show|expand to|switch to|go to|go back to)\s+(?:the\s+)?(?:full[ -]?width|full[ -]?screen|expanded)(?:\s+(?:view|mode|chat))?$/.test(text) || text === 'पूरा चैट खोलो') return 'expanded'
  if (/^(?:minimize(?: yourself| mira)?|switch to pip|go to pip|stay in pip)$/.test(text)) return 'pip'
  return null
}
