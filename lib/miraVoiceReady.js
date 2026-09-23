let cached
const identity = () => localStorage.getItem('token') || document.cookie.match(/token=([^;]+)/)?.[1] || ''
export function prewarmMiraVoice() {
  const owner = identity()
  if (!owner) return Promise.resolve(null)
  if (cached?.owner === owner && Date.now() - cached.time < 60000) return cached.promise
  const entry = { owner, time: Date.now() }
  entry.promise = fetch('/api/ai/mira-voice/token', { method: 'POST', headers: { Authorization: `Bearer ${owner}` } })
    .then(async response => { if (!response.ok) throw new Error('Voice connection unavailable.'); return (await response.json()).token })
    .catch(() => { if (cached === entry) cached = null; return null })
  cached = entry
  return entry.promise
}
export async function takeMiraVoiceToken() {
  const pending = prewarmMiraVoice()
  cached = null // A single-use token is never handed to two sessions.
  return pending
}
