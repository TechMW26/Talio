import { isMiraDismissal } from './miraDismissal'
import { createMiraFillerSelector, miraFillerCategory, MIRA_FILLER_LIBRARY } from './miraFillerLibrary'

export function miraWaitingPhrase(text, language = 'en', select) {
  const value = String(text || '').trim()
  // Feedback belongs to a meaningful request, never a pause, goodbye, small
  // acknowledgement, audibility check, or emotionally sensitive disclosure.
  if (isMiraDismissal(value) || value.split(/\s+/u).length < 2 || /\b(wait|pause|quiet|silent|silence|stop|hold on|one second|one moment|give me|hear me|audible|hello|hi|thanks|died|depressed|suicide|hurt|grief)\b|रुको|रुकिए|चुप|एक मिनट|सुन रही|सुन पा|धन्यवाद|नमस्ते|मौत|दुख|परेशान|रुकिये|\b(ruko|rukiye|chup)\b/iu.test(value)) return null
  const category = miraFillerCategory(value)
  language = language === 'hi' ? 'hi' : 'en'
  return category ? (select ? select(category, language) : MIRA_FILLER_LIBRARY.find(item => item.category === category && item.language === language)?.text) : null
}

// One optional filler per delayed turn, with a cooldown across turns. Audio
// failures are non-fatal; the answer takes over at a safe audio boundary.
export function createMiraWaitingFeedback({ playback, live, onStart, onEnd, now = Date.now }) {
  let current, lastPlayed = -Infinity
  const select = createMiraFillerSelector()
  const finish = waiting => {
    if (waiting.finished) return
    waiting.finished = true
    clearTimeout(waiting.timer); clearTimeout(waiting.deadline)
    if (current === waiting) { current = null; if (waiting.playing) onEnd?.() }
    waiting.resolve()
  }
  const stop = () => {
    const waiting = current
    if (!waiting) return
    waiting.ticket.cancel(); finish(waiting)
  }
  return {
    stop,
    async handoff() {
      const waiting = current
      if (!waiting) return
      if (!waiting.playing) { stop(); return }
      // A stalled player must not block the real reply indefinitely.
      if (!waiting.deadline) waiting.deadline = setTimeout(() => { waiting.ticket.cancel(); finish(waiting) }, 4000)
      await waiting.done
    },
    start(text, language) {
      stop()
      if (!playback.prepare || now() - lastPlayed < 12000 || !live()) return
      const phrase = miraWaitingPhrase(text, language, select)
      if (!phrase) return
      const waiting = { ticket: playback.prepare(phrase, { cache: true }) }
      waiting.done = new Promise(resolve => { waiting.resolve = resolve })
      current = waiting
      waiting.timer = setTimeout(async () => {
        try {
          const ready = await waiting.ticket.result
          if (current !== waiting || !live() || ready.error || ready.cancelled) return
          await playback.speak(phrase, () => {
            if (current !== waiting || !live()) return
            waiting.playing = true
            lastPlayed = now(); onStart?.(phrase)
          }, waiting.ticket)
        } catch { /* A filler is optional; never fail or retry the user's task. */ }
        finally { finish(waiting) }
      }, 700)
    },
  }
}
