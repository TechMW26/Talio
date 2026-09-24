import { playSound, unlockAudio } from '@/utils/audio'

// Keep the existing notification API and preferences; use the supplied pack.
class NotificationSoundManager {
  constructor() { this.enabled = true; this.volume = 0.4 }
  init() { return this }
  setEnabled(enabled) { this.enabled = enabled }
  setVolume(volume) { this.volume = Math.max(0, Math.min(1, volume)) }
  async resume() { await unlockAudio() }
  play(key) { if (this.enabled) return playSound(key, this.volume) }
  playChime() { return this.play('notification') }
  playSuccess() { return this.play('success') }
  playAlert() { return this.play('alert') }
  playWarning() { return this.play('error') }
  playUpdate() { return this.play('click') }
  playPop() { return this.play('messageNotification') }
  playUrgent() { return this.play('alert') }
  playRefresh() { return this.play('click') }
}

// Singleton instance
let soundManager = null

export function getNotificationSounds() {
  if (typeof window === 'undefined') {
    // Return a no-op object for SSR
    return {
      init: () => {},
      setEnabled: () => {},
      setVolume: () => {},
      resume: () => {},
      playChime: () => {},
      playSuccess: () => {},
      playAlert: () => {},
      playWarning: () => {},
      playUpdate: () => {},
      playPop: () => {},
      playUrgent: () => {},
      playRefresh: () => {}
    }
  }
  
  if (!soundManager) {
    soundManager = new NotificationSoundManager()
  }
  return soundManager
}

// Convenience exports for different notification types
export const NotificationSoundTypes = {
  CHIME: 'chime',        // General notification
  SUCCESS: 'success',    // Task completed, approved
  ALERT: 'alert',        // New task assigned, important update
  WARNING: 'warning',    // Rejection, issue
  UPDATE: 'update',      // Status change
  POP: 'pop',           // Quick notification
  URGENT: 'urgent',     // High priority
  REFRESH: 'refresh'    // Data refreshed with changes
}

export function playNotificationSound(type) {
  const sounds = getNotificationSounds()
  
  switch (type) {
    case NotificationSoundTypes.CHIME:
      sounds.playChime()
      break
    case NotificationSoundTypes.SUCCESS:
      sounds.playSuccess()
      break
    case NotificationSoundTypes.ALERT:
      sounds.playAlert()
      break
    case NotificationSoundTypes.WARNING:
      sounds.playWarning()
      break
    case NotificationSoundTypes.UPDATE:
      sounds.playUpdate()
      break
    case NotificationSoundTypes.POP:
      sounds.playPop()
      break
    case NotificationSoundTypes.URGENT:
      sounds.playUrgent()
      break
    case NotificationSoundTypes.REFRESH:
      sounds.playRefresh()
      break
    default:
      sounds.playChime()
  }
}
