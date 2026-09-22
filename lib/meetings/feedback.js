import { getNotificationSounds, playNotificationSound } from '@/lib/notificationSounds'

// Call on a user gesture. Never request microphone/camera access for alerts.
export function unlockMeetingSounds() {
  try {
    const sounds = getNotificationSounds()
    sounds.init()
    Promise.resolve(sounds.resume()).catch(() => {})
  } catch { /* Browser audio may be unavailable or blocked. */ }
}

export function createMeetingFeedback(allowedReactions, play = playNotificationSound, now = Date.now) {
  const seen = new Set()
  const hands = new Map()
  let lastSoundAt = -Infinity
  return ({ topic, data, sender, localIdentity }) => {
    if (!sender || sender === localIdentity) return false
    if (topic === 'talio-reaction' && !allowedReactions.includes(data.reaction)) return false
    if (topic === 'talio-hand' && typeof data.raised !== 'boolean') return false
    if (!['talio-hand', 'talio-reaction'].includes(topic)) return false
    if (data.id) {
      const key = `${sender}:${topic}:${data.id}`
      if (seen.has(key)) return false
      seen.add(key)
      if (seen.size > 500) seen.delete(seen.values().next().value)
    }
    let notify = true
    if (topic === 'talio-hand') {
      notify = data.raised && !hands.get(sender)
      hands.set(sender, data.raised)
    }
    const timestamp = now()
    if (notify && timestamp - lastSoundAt >= 750) {
      lastSoundAt = timestamp
      try { play(topic === 'talio-hand' ? 'chime' : 'pop') } catch { /* Visual feedback still works. */ }
    }
    return true
  }
}
