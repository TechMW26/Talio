const normalize = value => String(value || '').trim().replace(/\s+/g, ' ')

// Only standalone call checks qualify. A compound request (for example,
// "can you hear me and open projects") must still reach the authenticated tool.
export function isMiraAudibilityCheck(value) {
  const text = normalize(value).replace(/^(?:hey\s+)?(?:mira|meera|मीरा)[,\s:—-]*/iu, '').replace(/[?!.।]+$/u, '').trim()
  return /^(?:am i audible|can you hear me|do you hear me|is my (?:voice|microphone|mic) (?:working|audible)|(?:kya\s+)?(?:tum|aap)\s+(?:mujhe|meri\s+(?:awaaz|awaz))\s+sun\s+(?:rahi|rahe)\s+(?:ho|hain)|(?:क्या\s+)?(?:तुम|आप)\s+(?:मुझे|मेरी\s+आवाज़|मेरी\s+आवाज)\s+सुन\s+(?:रही|रहे)\s+(?:हो|हैं))$/iu.test(text)
}

// Client-tool retries must not resend writes, even when a provider changes its
// tool-call ID. Bind execution to a final transcript received on this session.
export function createMiraVoiceTurns() {
  let current = null, sequence = 0
  const results = new Map(), events = new Set()
  return {
    latest() { return current ? { text: current.text, sequence: current.sequence } : null },
    transcript(text, eventId) {
      if (eventId !== undefined && events.has(eventId)) return false
      if (eventId !== undefined) { events.add(eventId); if (events.size > 64) events.delete(events.values().next().value) }
      current = { text: normalize(text), sequence: ++sequence, promise: null }
      return true
    },
    execute({ message, utterance_id }, run) {
      if (typeof utterance_id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(utterance_id)) throw new Error('Invalid voice turn')
      if (results.has(utterance_id)) return results.get(utterance_id)
      if (!current || current.text !== normalize(message) || !current.text || current.text.length > 5000) throw new Error('Voice turn does not match a final transcript')
      const turn = current
      if (!turn.promise) turn.promise = Promise.resolve().then(() => run(turn.text))
      results.set(utterance_id, turn.promise)
      if (results.size > 64) results.delete(results.keys().next().value)
      return turn.promise
    },
  }
}

export function miraListeningWord(previousTranscript, variation = 0) {
  // Script alone is not language. Only clear Roman Hindi cues select Hinglish.
  if (/\b(acha|achha|hai|haan|karna|karo|mujhe|nahi|theek|batao|aur|mera|meri)\b/i.test(previousTranscript || '')) return variation % 2 ? 'Hmm.' : 'Achha.'
  if (variation % 2 && /\b(please|you|this|my|me|the|help|need|how|can|with)\b/i.test(previousTranscript || '')) return 'Okay.'
  return 'Hmm.'
}

export function createMiraAcknowledgementCadence() {
  let speechStart = null, lastAck = -Infinity, acknowledged = false
  return {
    newTurn() { speechStart = null; acknowledged = false },
    sample(score, now, listening) {
      if (!listening || score < 0.7) { speechStart = null; return false }
      if (speechStart === null) speechStart = now
      if (acknowledged || now - speechStart < 6000 || now - lastAck < 18000) return false
      acknowledged = true; lastAck = now
      return true
    },
  }
}
