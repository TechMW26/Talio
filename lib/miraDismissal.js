// Match complete dismissal utterances, not words quoted inside another request.
import { isMiraHinglishReply } from './miraLanguage'

export function isMiraDismissal(value) {
  let text = String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[’']/g, '').replace(/[.,!?।¿¡-]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\bmire\b|मिरे|मिरा/gu, 'mira')
  if (/^(?:(?:hey )?(?:mira|meera|myra|मीरा) (?:please )?(?:stop|off|स्टॉप|ऑफ)|(?:stop|बस) (?:mira|meera|myra|मीरा))$/u.test(text)) return true
  // Peel off conversational fillers only at the boundaries. Never search for
  // a goodbye substring inside an instruction, quotation, or negation.
  const filler = '(?:okay|ok|alright|(?:and )?(?:thanks|thank you)|done|please|बस(?!\\s+करो)|ठीक है|धन्यवाद|(?:hey\\s+)?(?:mira|meera|myra|मीरा|मेरा))'
  const boundary = new RegExp(`^(?:${filler})\\s+|\\s+(?:${filler})$`, 'gu')
  let previous
  do { previous = text; text = text.replace(boundary, '').trim() } while (previous !== text)
  // Only complete commands: never match "close the project", quoted goodbyes,
  // negations, or a request to end the call after another action.
  text = text.replace(/^(?:can|could|would|will) you (?:please )?/, '')
    .replace(/^lets\s+/, '')
    .replace(/^(?:please )?(?:ab|अब)\s+/, '')
    .replace(/\s+(?:now|for now|ab|अब)$/, '')
  if (/^(?:(?:turn|switch|shut) (?:yourself |the (?:voice|assistant) )?off|(?:turn|switch) off (?:the )?(?:voice|assistant)|shut down|stop talking|stop speaking|stop listening|end (?:voice|voice mode)|close (?:voice|voice mode)|बस बंद करो|बंद करो|चुप हो जाओ|बाय बाय|कॉल काट दो|जाओ|jao|call kaat do|band karo|chup ho jao)$/u.test(text)) return true
  text = text.replace(/^(?:hey\s+)?(?:mira|meera|myra|मीरा)[,\s]+/u, '')
    .replace(/\s+(?:mira|meera|myra|मीरा)$/u, '')
    .replace(/^(?:okay|ok|alright|thanks|thank you)[,\s]+/u, '')
    .replace(/^please\s+|\s+please$/gu, '').trim()
  if (/^(?:(?:end|stop|disconnect)(?: (?:the|this|our))? (?:call|voice call|voice conversation)|hang ?up|good ?night|bas karo|band ho jao|call (?:band|khatam) karo|बस करो|कॉल बंद करो|कॉल खत्म करो)$/u.test(text)) return true
  if (/^(?:(?:end|finish|close|stop)(?: (?:the|this|our))? (?:conversation|discussion|session)|you can close(?: yourself)?|we can (?:stop|end|finish)(?: here)?|thats enough(?: for (?:today|now))?|बात(?:चीत)? (?:खत्म|बंद) करो|आज के लिए इतना ही|बस इतना ही|ab bas|baat khatam karo|bye(?: bye)?(?: mira)?(?: and)? (?:see you(?: later)?|good ?night|talk to you later))$/u.test(text)) return true
  return /^(?:bye(?: bye)?|goodbye|good bye|adios|adiós|hasta luego|au revoir|ciao|tschüss|see you(?: later)?|talk to you later|go away|you can go(?: now)?|leave me alone|thats all(?: for now)?|we(?:re| are) done|im done|dismiss(?: yourself| mira)?|close(?: yourself| mira| (?:the |this )?(?:chat|popup|pop up|window|assistant))?|go (?:back )?to (?:sleep|standby)|stop (?:the )?(?:conversation|voice chat)|बाय|अलविदा|फिर मिलेंगे|अब जाओ|तुम जा सकती हो|बंद हो जाओ|मीरा बंद करो)$/u.test(text)
}

export function buildMiraDismissalResponse(value) {
  if (!isMiraDismissal(value)) return null
  return {
    message: isMiraHinglishReply(value) ? 'Theek hai, phir milenge.' : 'Bye! See you later.',
    action: { type: 'dismiss' },
    cards: [],
    suggestedQuestions: [],
  }
}
