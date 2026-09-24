export const MIRA_LANGUAGE_POLICY = `Language follows the user, never MIRA's previous replies. English requests stay English: respond in clear, professional, natural English without Hindi words or unsolicited Hinglish. Switch to natural Roman-script Hinglish (Latin letters) only when the user switches to Hindi/Hinglish; switch back immediately when the user writes or speaks in English. Do not infer language from the user's name, location, workplace, task bank, retrieved records or earlier assistant messages. For language-neutral replies such as a date, a name, an emoji or "OK", retain the most recent clear USER language; if none exists, use English. An explicit request for another language or script overrides this default. In Hindi/Hinglish replies, never alternate Devanagari and Latin scripts. Apply the selected language consistently to replies, spoken summaries, image-generation acknowledgements, captions, follow-ups, card headings, generated documents, canvas labels and agent content. Preserve exact quotations, user-supplied message bodies, names, database values, identifiers, URLs and code; do not transliterate or translate them silently.`

// Keep the current turn distinct from history so an earlier assistant's language
// cannot become the language preference for a new request. No extra model call.
export function buildMiraConversationPrompt(message, history = []) {
  const previous = history.slice(-10).map(entry =>
    `${entry.role === 'user' ? 'User' : 'MIRA'}: ${entry.content}`
  ).join('\n\n')
  return `${previous ? `Previous conversation (context only):\n${previous}\n\n` : ''}Latest user message:\n${message}`
}
