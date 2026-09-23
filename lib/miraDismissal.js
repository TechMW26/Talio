// Match complete dismissal utterances, not words quoted inside another request.
export function isMiraDismissal(value) {
  let text = String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[’']/g, '').replace(/[.,!?।¿¡]/g, ' ').replace(/\s+/g, ' ').trim()
  // Peel off conversational fillers only at the boundaries. Never search for
  // a goodbye substring inside an instruction, quotation, or negation.
  const filler = '(?:okay|ok|alright|thanks|thank you|done|please|बस|ठीक है|धन्यवाद|(?:hey\\s+)?(?:mira|meera|myra|मीरा|मेरा))'
  const boundary = new RegExp(`^(?:${filler})\\s+|\\s+(?:${filler})$`, 'gu')
  let previous
  do { previous = text; text = text.replace(boundary, '').trim() } while (previous !== text)
  text = text.replace(/^(?:hey\s+)?(?:mira|meera|myra|मीरा)[,\s]+/u, '')
    .replace(/\s+(?:mira|meera|myra|मीरा)$/u, '')
    .replace(/^(?:okay|ok|alright|thanks|thank you)[,\s]+/u, '')
    .replace(/^please\s+|\s+please$/gu, '').trim()
  return /^(?:bye(?: bye)?|goodbye|good bye|adios|adiós|hasta luego|au revoir|ciao|tschüss|see you(?: later)?|talk to you later|go away|you can go(?: now)?|leave me alone|thats all(?: for now)?|we(?:re| are) done|im done|dismiss(?: yourself| mira)?|close(?: yourself| mira| (?:the |this )?(?:chat|popup|pop up|window|assistant))?|go (?:back )?to (?:sleep|standby)|stop (?:the )?(?:conversation|voice chat)|बाय|अलविदा|फिर मिलेंगे|अब जाओ|तुम जा सकती हो|बंद हो जाओ|मीरा बंद करो)$/u.test(text)
}

export function buildMiraDismissalResponse(value) {
  if (!isMiraDismissal(value)) return null
  return {
    message: /[\u0900-\u097f]/u.test(value) ? 'Theek hai, phir milenge.' : 'Bye! See you later.',
    action: { type: 'dismiss' },
    cards: [],
    suggestedQuestions: [],
  }
}
