// Professional notification sounds using Web Audio API
// These create unique, pleasant sounds without needing external audio files

class NotificationSoundManager {
  constructor() {
    this.audioContext = null
    this.enabled = true
    this.volume = 0.4
  }

  init() {
    if (typeof window === 'undefined') return
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
    }
    return this
  }

  setEnabled(enabled) {
    this.enabled = enabled
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume))
  }

  // Resume audio context (needed after user interaction)
  async resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume()
      } catch {
        // Autoplay policy can reject resume until a user gesture; retry then.
      }
    }
  }

  // Create a pleasant chime sound - for general notifications
  playChime() {
    if (!this.enabled) return
    this.init()
    this.resume()

    const ctx = this.audioContext
    const now = ctx.currentTime

    // Create oscillators for a pleasant two-tone chime
    const osc1 = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    const gain = ctx.createGain()

    osc1.type = 'sine'
    osc2.type = 'sine'
    osc1.frequency.setValueAtTime(880, now) // A5
    osc2.frequency.setValueAtTime(1318.5, now) // E6

    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(this.volume * 0.3, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)

    osc1.connect(gain)
    osc2.connect(gain)
    gain.connect(ctx.destination)

    osc1.start(now)
    osc2.start(now)
    osc1.stop(now + 0.5)
    osc2.stop(now + 0.5)
  }

  // Success sound - ascending tones for positive events (task completed, approved)
  playSuccess() {
    if (!this.enabled) return
    this.init()
    this.resume()

    const ctx = this.audioContext
    const now = ctx.currentTime

    const notes = [523.25, 659.25, 783.99] // C5, E5, G5 - major chord arpeggio
    
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now)
      
      const startTime = now + (i * 0.08)
      gain.gain.setValueAtTime(0, startTime)
      gain.gain.linearRampToValueAtTime(this.volume * 0.25, startTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3)
      
      osc.connect(gain)
      gain.connect(ctx.destination)
      
      osc.start(startTime)
      osc.stop(startTime + 0.3)
    })
  }

  // Alert sound - for important notifications (new task assigned)
  playAlert() {
    if (!this.enabled) return
    this.init()
    this.resume()

    const ctx = this.audioContext
    const now = ctx.currentTime

    // Two-tone alert: D5 - A5
    const frequencies = [587.33, 880]
    
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, now)
      
      const startTime = now + (i * 0.15)
      gain.gain.setValueAtTime(0, startTime)
      gain.gain.linearRampToValueAtTime(this.volume * 0.35, startTime + 0.01)
      gain.gain.setValueAtTime(this.volume * 0.35, startTime + 0.1)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25)
      
      osc.connect(gain)
      gain.connect(ctx.destination)
      
      osc.start(startTime)
      osc.stop(startTime + 0.25)
    })
  }

  // Warning sound - for rejections or issues
  playWarning() {
    if (!this.enabled) return
    this.init()
    this.resume()

    const ctx = this.audioContext
    const now = ctx.currentTime

    // Descending minor tone
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(440, now) // A4
    osc.frequency.linearRampToValueAtTime(349.23, now + 0.2) // F4

    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(this.volume * 0.3, now + 0.02)
    gain.gain.setValueAtTime(this.volume * 0.3, now + 0.15)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.4)
  }

  // Update sound - for status changes
  playUpdate() {
    if (!this.enabled) return
    this.init()
    this.resume()

    const ctx = this.audioContext
    const now = ctx.currentTime

    // Soft pop sound
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    
    osc.type = 'sine'
    osc.frequency.setValueAtTime(698.46, now) // F5
    osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.1) // C5

    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(this.volume * 0.25, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.15)
  }

  // New message/notification pop
  playPop() {
    if (!this.enabled) return
    this.init()
    this.resume()

    const ctx = this.audioContext
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1046.5, now) // C6
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.08) // G5

    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(this.volume * 0.2, now + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.12)
  }

  // Urgent/priority notification
  playUrgent() {
    if (!this.enabled) return
    this.init()
    this.resume()

    const ctx = this.audioContext
    const now = ctx.currentTime

    // Double beep pattern
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      
      osc.type = 'square'
      osc.frequency.setValueAtTime(880, now) // A5
      
      const startTime = now + (i * 0.2)
      gain.gain.setValueAtTime(0, startTime)
      gain.gain.linearRampToValueAtTime(this.volume * 0.15, startTime + 0.01)
      gain.gain.setValueAtTime(this.volume * 0.15, startTime + 0.08)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(startTime)
      osc.stop(startTime + 0.1)
    }
  }

  // Gentle reminder/refresh notification
  playRefresh() {
    if (!this.enabled) return
    this.init()
    this.resume()

    const ctx = this.audioContext
    const now = ctx.currentTime

    // Soft whoosh-like sound
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    
    osc.type = 'sine'
    osc.frequency.setValueAtTime(400, now)
    osc.frequency.linearRampToValueAtTime(600, now + 0.1)
    osc.frequency.linearRampToValueAtTime(400, now + 0.2)

    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(this.volume * 0.1, now + 0.05)
    gain.gain.linearRampToValueAtTime(this.volume * 0.1, now + 0.15)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.25)
  }
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
