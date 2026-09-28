export const MIRA_LANGUAGE_POLICY = `STRICT LANGUAGE CONTRACT:
English is the default for new conversations and whenever the user's language choice is unclear. Follow a deliberate user language choice, never MIRA's previous replies.
Select the reply language in this order: (1) an explicit user request for a language, translation or script; (2) the latest clear language-bearing USER message; (3) an explicit user-selected language from the current conversation for language-neutral follow-ups such as a date, name, emoji or "OK"; (4) English. A clear current English message MUST receive an English reply even if earlier MIRA replies or older conversation turns were in Hindi/Hinglish. Switch immediately when the user intentionally switches languages, including back to English. An explicit language preference persists only until the user changes it.
Support every language the model can understand, not just English and Hindi: regional languages, dialects and non-Latin scripts are welcome. Do not restrict replies to a fixed language list. English requests stay English: use professional, natural English without unsolicited Hindi or Hinglish. Hindi and Hindi-English requests always receive natural Roman-script Hinglish, including when Hindi input or speech transcription is in Devanagari. Do not generate Devanagari Hindi conversational prose or spoken summaries. A request to switch to Hindi means Roman-script Hinglish by default. Only an explicit request for an exact translation, quotation or document in Devanagari overrides this output-script rule. Match the user's script and transliteration style for other languages. Never assume that all Devanagari is Hindi or that all Latin-script text is English. For mixed-language requests, follow the dominant conversational language and the user's natural mixing style; isolated technical terms or names do not trigger a language switch. Do not introduce a second language the user did not use or request.
Treat spelling answers, initials, contact names, numbers, dates and brief acknowledgements as language-neutral. In particular, "S-A-H-I-L", "S as in Sam" and a contact's English name do not switch a Hinglish conversation to English. Use the surrounding user conversation, not speech-recognition script alone. A clear English request switches back to professional English unless the user explicitly asked to keep another language. One borrowed word, name, quoted passage, or a previous MIRA reply is never an intentional language change. Switch smoothly without announcing the switch or repeating the answer in two languages.
Do not infer language from the user's name, location, workplace, browser locale, task bank, retrieved records, attachments, quoted passages or earlier assistant messages. A quoted foreign passage does not change the language of the user's surrounding question. If a language genuinely cannot be understood, ask a brief clarification instead of inventing a translation or claiming universal fluency.
Apply the selected language consistently to replies, spoken summaries, image-generation acknowledgements, captions, follow-ups, card headings, generated documents, canvas labels and agent content. Requested translations and explicitly requested output languages are intentional exceptions. Preserve exact quotations, user-supplied message bodies, names, database values, identifiers, URLs and code; do not transliterate or translate them silently. Keep JSON keys, tool names, action types and enum values in their required machine format. Before emitting any response or speech, check that all generated user-facing prose follows this contract; rewrite mismatched prose before sending it. This check must not change action arguments, repeat actions or claim an unverified outcome.`

const ENGLISH_MARKERS = new Set('a about after all also am an and any are as at be because been before being below between both but by can could did do does doing down during each even few for from further get give go had has have he her here hers him his how i if in into is it its just like make many may me more most much must my near need no nor not of off on once only or other our out over own same she should so some such than that the their theirs them then there these they this those through to too under until up us very was we were what when where which while who whom why will with would you your yours please hello hey hi thanks thank'.split(' '))
const STRONG_HINGLISH_MARKERS = new Set('aap alvida band batao bataiye bana banao banaiye banaye bye hai hain ho jao kaise kar karo karna kya kyun main mai mein mera mere meri milenge mujhe nahi nahin chahiye kholo dikhao dikhaiye bhejo phir samjhao samjhi samjha sakta sakti theek liye'.split(' '))
const HINDI_DEVANAGARI_MARKERS = new Set('अलविदा आप बताओ बताइए बाय बंद धन्यवाद फिर है हैं हो जाओ कैसे कर करो करना क्या क्यों मैं मेरा मेरी मुझे नहीं चाहिए खोलो दिखाओ भेजो समझाओ ठीक मिलेंगे'.split(' '))
const MARATHI_DEVANAGARI_MARKERS = new Set('आहे आहेत माझा माझी माझे माझ्या दाखवा सांगा करा करू शकता'.split(' '))
const LANGUAGE_STYLE_WORDS = new Set('a an the my your please from now on only language same clear simple plain natural short concise detailed detail brief conversational response replies answer answers written spoken and but so then today ignore system words sentence way calm voice tone shorter format paragraph paragraphs bullet bullets points one own assertive professional formal casual friendly native more polished code json next previous another new ready working'.split(' '))
const LANGUAGE_CLAUSE_WORDS = new Set('and but so then today ignore system rules from with while because if when where about this that these those you your me my all always only in on at for to as'.split(' '))
const NON_LANGUAGE_LABELS = new Set('app application apps calendar dashboard desktop history meeting meetings page pages pip screen settings tab task tasks view window'.split(' '))
const LANGUAGE_WORDS = new Set('afrikaans albanian amharic arabic armenian assamese azerbaijani basque bengali bosnian bulgarian burmese cantonese catalan chinese croatian czech danish dari dutch english estonian filipino finnish french georgian german greek gujarati hebrew hindi hinglish hungarian icelandic indonesian irish italian japanese kannada kazakh khmer korean lao latvian lithuanian malay malayalam mandarin marathi nepali norwegian odia pashto persian polish portuguese punjabi romanian russian sanskrit serbian sinhala slovak slovenian somali spanish swahili swedish tamil telugu thai tibetan turkish ukrainian urdu uzbek vietnamese welsh'.split(' '))

function withoutQuotedText(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```|`[^`]*`/g, ' ')
    .replace(/"[^"\n]*"|(^|\s)'[^'\n]*'(?=\s|$)|“[^”\n]*”|‘[^’\n]*’/g, ' ')
}

function wordTokens(value) {
  return String(value || '').toLocaleLowerCase().match(/[\p{L}\p{M}]+/gu) || []
}

function explicitLanguageRequest(value) {
  const text = withoutQuotedText(value)
  const patterns = [
    /\b(?:reply|respond|answer|speak|talk|write|continue)\b[^.!?\n]{0,60}?\bin\s+([\p{L}-]+(?:\s+[\p{L}-]+){0,2})/iu,
    /\b(?:switch|change)\s+(?:the\s+)?(?:reply\s+)?language\s+to\s+([\p{L}-]+(?:\s+[\p{L}-]+){0,2})/iu,
    /\b(?:translate|render|write)\b[^.!?\n]{0,60}?\binto\s+([\p{L}-]+(?:\s+[\p{L}-]+){0,2})/iu,
    /\b(?:switch|change)\s+(?:back\s+)?to\s+([\p{L}-]+)\b/iu,
    /\b(?:use|keep)\s+([\p{L}-]+(?:\s+[\p{L}-]+){0,2})\s+(?:as\s+(?:the\s+)?(?:reply|response|conversation)\s+language|for\s+(?:all\s+)?(?:replies|responses))/iu,
    /\b([\p{L}-]+)\s+(?:mein|me)\s+(?:bolo|baat|jawab|likho|reply|answer)/iu,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (!match) continue
    const prefix = text.slice(Math.max(0, match.index - 12), match.index + match[0].indexOf(match[1])).toLowerCase()
    if (/\b(?:don['’]?t|do not|never|not)\s+(?:please\s+)?$/.test(prefix)) continue
    const words = []
    for (const word of wordTokens(match[1])) {
      if (LANGUAGE_CLAUSE_WORDS.has(word)) break
      if (!LANGUAGE_STYLE_WORDS.has(word)) words.push(word)
      if (words.length === 2) break
    }
    if (!words.length) continue
    if (words.length === 1 && NON_LANGUAGE_LABELS.has(words[0])) continue
    return words.join(' ')
  }
  const oneWord = wordTokens(text)
  if (oneWord.length === 1 && LANGUAGE_WORDS.has(oneWord[0])) return oneWord[0]
  if (oneWord.length === 2 && oneWord[0] === 'in' && LANGUAGE_WORDS.has(oneWord[1])) return oneWord[1]
  if (oneWord.length <= 2 && LANGUAGE_WORDS.has(oneWord[0]) && /\bplease\b/i.test(text)) return oneWord[0]
  return null
}

function classifyMiraUserLanguage(value) {
  const text = withoutQuotedText(value)
  const tokens = wordTokens(text)
  if (!tokens.length) return null

  const devanagari = tokens.filter(token => /[\u0900-\u097f]/u.test(token))
  if (devanagari.length) {
    const hindiCount = devanagari.filter(token => HINDI_DEVANAGARI_MARKERS.has(token)).length
    const marathiCount = devanagari.filter(token => MARATHI_DEVANAGARI_MARKERS.has(token)).length
    if (hindiCount > marathiCount && hindiCount > 0) return 'Hindi (Roman-script Hinglish)'
    const latinLetterCount = (text.match(/\p{Script=Latin}/gu) || []).length
    const devanagariLetterCount = (text.match(/[\u0900-\u097f]/gu) || []).length
    if (devanagariLetterCount >= 4 && devanagariLetterCount >= latinLetterCount) return 'the language of the current user message, using its appropriate script'
    // A single foreign-script term inside an otherwise English question is
    // quoted/reference content, not an intentional language switch.
  }

  const latinTokens = tokens.filter(token => /^[a-z]+$/u.test(token))
  const hinglishCount = latinTokens.filter(token => STRONG_HINGLISH_MARKERS.has(token)).length
  const englishCount = latinTokens.filter(token => ENGLISH_MARKERS.has(token)).length
  if (hinglishCount && hinglishCount >= englishCount) return 'Hindi (Roman-script Hinglish)'

  // Short action phrases such as "open WhatsApp" are clearly English too.
  const englishAction = new Set(['add', 'can', 'change', 'check', 'close', 'could', 'create', 'delete', 'do', 'does', 'explain', 'find', 'get', 'help', 'how', 'just', 'launch', 'list', 'make', 'my', 'open', 'please', 'remind', 'search', 'send', 'show', 'start', 'stop', 'switch', 'tell', 'what', 'when', 'where', 'who', 'why', 'write', 'your'])
  const isClearEnglish = (latinTokens.length >= 3 && englishCount >= 2 && englishCount / latinTokens.length >= 0.28) ||
    (latinTokens.length >= 2 && latinTokens.some(token => englishAction.has(token))) ||
    (latinTokens.length >= 2 && englishCount >= 2 && englishCount / latinTokens.length >= 0.5)
  if (isClearEnglish) return 'English'

  // If a substantive Latin-script utterance is not confidently English or
  // Hinglish, let the model match that current text instead of inheriting an
  // older language from the chat.
  if (latinTokens.length >= 3 && englishCount / latinTokens.length < 0.28) {
    return 'the language of the current user message, using its appropriate script'
  }

  // Other writing systems are clear evidence of a deliberate language switch,
  // but the script alone is not used to guess a specific language.
  const otherScriptLetters = text.match(/[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{Z}\p{S}]/gu) || []
  const latinLetterCount = (text.match(/\p{Script=Latin}/gu) || []).length
  if (otherScriptLetters.length >= 4 && otherScriptLetters.length >= latinLetterCount) {
    return 'the language and script used in the current user message'
  }
  return null
}

function languageDirective(language) {
  if (/^english$/i.test(language || '')) {
    return 'English is the selected reply language for this turn. Reply in natural English. This turn-level instruction overrides any Hindi/Hinglish in older user turns, all previous MIRA replies, names, quoted text, locale, and retrieved data.'
  }
  if (/^(?:hindi|hinglish)$/i.test(language || '') || language === 'Hindi (Roman-script Hinglish)') {
    return 'Hindi is the selected reply language for this turn. Reply in natural Roman-script Hinglish, not Devanagari Hindi. This selection comes from the user, not previous MIRA replies.'
  }
  if (language) {
    if (language.startsWith('the language')) return 'Select the reply language from the current user message itself and match its language and script. Do not inherit the language of previous MIRA replies or older user turns. If the current language is unclear, use English.'
    const displayLanguage = language.replace(/\b\p{L}/gu, first => first.toLocaleUpperCase())
    return `Reply in ${displayLanguage}. Match the language of the user's current message; do not infer it from previous MIRA replies or unrelated context.`
  }
  return 'English is the default reply language for this turn. Use another language only when the user explicitly requests it or clearly communicates in it.'
}

// Build a small, deterministic per-turn language instruction. This keeps a
// prior Hindi assistant reply from becoming a language preference by accident.
export function buildMiraOutputLanguageDirective(message, history = []) {
  const explicit = explicitLanguageRequest(message)
  if (explicit) return languageDirective(explicit)

  const current = classifyMiraUserLanguage(message)
  if (current) return languageDirective(current)

  const priorUserLanguage = [...history].reverse()
    .filter(entry => entry?.role === 'user')
    .map(entry => explicitLanguageRequest(entry.content) || classifyMiraUserLanguage(entry.content))
    .find(Boolean)
  return priorUserLanguage ? languageDirective(priorUserLanguage) : 'English is the default reply language for this turn. Use another language only when the user explicitly requests it or clearly communicates in it.'
}

export function isMiraHinglishReply(message, history = []) {
  return buildMiraOutputLanguageDirective(message, history).startsWith('Hindi is the selected reply language')
}

// Keep the current turn distinct from history so an earlier assistant's language
// cannot become the language preference for a new request. No extra model call.
export function buildMiraConversationPrompt(message, history = []) {
  const previous = history.slice(-10).map(entry =>
    `${entry.role === 'user' ? 'User' : 'MIRA'}: ${entry.content}`
  ).join('\n\n')
  return `${previous ? `Previous conversation (context only):\n${previous}\n\n` : ''}Latest user message:\n${message}`
}
