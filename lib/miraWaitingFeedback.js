import { isMiraDismissal } from './miraDismissal'

export function miraWaitingPhrase(text, language = 'en') {
  const value = String(text || '').trim()
  // Feedback belongs to a meaningful request, never a pause, goodbye, small
  // acknowledgement, audibility check, or emotionally sensitive disclosure.
  if (isMiraDismissal(value) || value.split(/\s+/u).length < 2 || /\b(wait|pause|quiet|silent|silence|stop|hold on|one second|one moment|give me|hear me|audible|hello|hi|thanks|died|depressed|suicide|hurt|grief)\b|रुको|रुकिए|चुप|एक मिनट|सुन रही|सुन पा|धन्यवाद|नमस्ते|मौत|दुख|परेशान|रुकिये|\b(ruko|rukiye|chup)\b/iu.test(value)) return null
  const hindi = language === 'hi'
  if (/\b(check|find|search|look up|show|open|send|schedule|tasks?|projects?|meetings?)\b|देख|ढूँढ|खोज|दिखा|खोल|भेज|\b(dekho|dikhao|khojo|kholo|bhejo)\b/iu.test(value)) return hindi ? '[warm][fast] देखती हूँ।' : '[warm][fast] Let me check.'
  if (/\b(write|draft|compose|rewrite|summarize|summarise)\b|लिख|सारांश|\b(likho|banao)\b/iu.test(value)) return hindi ? '[warm][fast] अच्छा, एक पल।' : '[warm][fast] Okay, one moment.'
  if (/\b(what|why|how|explain|compare|which|would|should)\b|क्यों|कैसे|समझा|क्या|कौन|\b(kya|kyun|kaise|samjhao)\b/iu.test(value)) return hindi ? '[warm][fast] एक पल सोचने दीजिए।' : '[warm][fast] Let me think.'
  return null
}

// One optional filler per delayed turn, with a cooldown across turns. Audio
// failures are non-fatal; readiness of the real reply always wins the race.
export function createMiraWaitingFeedback({ playback, live, onStart, onEnd, now = Date.now }) {
  let current, lastPlayed = -Infinity
  const stop = () => {
    const waiting = current
    current = null
    clearTimeout(waiting?.timer)
    waiting?.ticket.cancel()
  }
  return {
    stop,
    start(text, language) {
      stop()
      const phrase = miraWaitingPhrase(text, language)
      if (!phrase || !playback.prepare || now() - lastPlayed < 12000 || !live()) return
      const waiting = { ticket: playback.prepare(phrase, { cache: true }) }
      current = waiting
      waiting.timer = setTimeout(async () => {
        try {
          const ready = await waiting.ticket.result
          if (current !== waiting || !live() || ready.error || ready.cancelled) return
          await playback.speak(phrase, () => {
            if (current !== waiting || !live()) return
            lastPlayed = now(); onStart?.(phrase)
          }, waiting.ticket)
        } catch { /* A filler is optional; never fail or retry the user's task. */ }
        finally { if (current === waiting) { current = null; onEnd?.() } }
      }, 700)
    },
  }
}
