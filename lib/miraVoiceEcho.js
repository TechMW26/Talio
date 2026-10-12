const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

// Secondary guard, not a substitute for WebRTC acoustic echo cancellation.
// Only matching playback phrases are ignored, never all speech during playback.
export function createMiraVoiceEchoGuard() {
  let reply = '', speaking = false, tailUntil = 0
  const rejected = new Map()
  return {
    remember(text) { reply = normalize(text) },
    mode(mode, now) {
      if (mode === 'speaking') speaking = true
      else if (speaking) { speaking = false; tailUntil = now + 1800 }
    },
    reject(text, now, fromTool = false) {
      const candidate = normalize(text)
      for (const [key, expiry] of rejected) if (expiry <= now) rejected.delete(key)
      if (fromTool && rejected.has(candidate)) return true
      // Keep short interruptions ("stop", "wait", "no") and different requests.
      const isEcho = (speaking || now < tailUntil) && candidate.split(' ').length >= 3 && reply && (` ${reply} `).includes(` ${candidate} `)
      if (isEcho) {
        rejected.set(candidate, now + 8000)
        if (rejected.size > 16) rejected.delete(rejected.keys().next().value)
      }
      else if (!fromTool) rejected.delete(candidate)
      return Boolean(isEcho)
    },
  }
}
