/**
 * Robust Audio utility for notification sounds
 * Uses Web Audio API (same pattern as CallAlertReceiver) with localStorage caching
 * for instant playback on first load
 */

// Sound file paths
const SOUNDS = {
  loginSuccess: '/sounds/login-success.mp3',
  messageNotification: '/sounds/message-notifications.mp3',
  error: '/sounds/error.mp3',
  notification: '/sounds/notification.mp3',
  success: '/sounds/success.mp3',
  taskDone: '/sounds/taskdone.mp3',
  gameInvite: '/sounds/yay-6120.mp3'
}

// Global AudioContext instance (same pattern as CallAlertReceiver)
let audioContextInstance = null
let audioContextUnlocked = false

// In-memory audio buffer cache
const audioBufferCache = {}

// localStorage key for cached audio data (v2 includes new sounds)
const AUDIO_CACHE_KEY = 'talio_audio_cache_v2'

/**
 * Get or create AudioContext instance
 */
function getAudioContext() {
  if (typeof window === 'undefined') return null
  
  if (!audioContextInstance) {
    try {
      audioContextInstance = new (window.AudioContext || window.webkitAudioContext)()
      console.log('[Audio] Created AudioContext, state:', audioContextInstance.state)
    } catch (err) {
      console.error('[Audio] Failed to create AudioContext:', err)
      return null
    }
  }
  return audioContextInstance
}

/**
 * Unlock AudioContext - CRITICAL for browsers that suspend audio until user interaction
 */
async function unlockAudioContextInternal() {
  const ctx = getAudioContext()
  if (!ctx) return false

  if (ctx.state === 'suspended') {
    console.log('[Audio] AudioContext suspended, attempting to resume...')
    try {
      await ctx.resume()
      console.log('[Audio] AudioContext resumed, state:', ctx.state)
    } catch (err) {
      console.error('[Audio] Failed to resume AudioContext:', err)
      return false
    }
  }

  audioContextUnlocked = ctx.state === 'running'
  return audioContextUnlocked
}

/**
 * Convert ArrayBuffer to Base64 for localStorage storage
 */
function arrayBufferToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Convert Base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Load audio from localStorage cache
 */
function loadFromCache() {
  if (typeof window === 'undefined') return {}
  
  try {
    const cached = localStorage.getItem(AUDIO_CACHE_KEY)
    if (cached) {
      console.log('[Audio] Loaded audio cache from localStorage')
      return JSON.parse(cached)
    }
  } catch (err) {
    console.warn('[Audio] Failed to load cache:', err)
  }
  return {}
}

/**
 * Save audio to localStorage cache
 */
function saveToCache(key, base64Data) {
  if (typeof window === 'undefined') return
  
  try {
    const cache = loadFromCache()
    cache[key] = base64Data
    localStorage.setItem(AUDIO_CACHE_KEY, JSON.stringify(cache))
    console.log('[Audio] Saved', key, 'to localStorage cache')
  } catch (err) {
    console.warn('[Audio] Failed to save cache:', err)
  }
}

/**
 * Fetch and cache audio file
 */
async function fetchAndCacheAudio(key, url) {
  const ctx = getAudioContext()
  if (!ctx) return null

  try {
    // Check localStorage cache first
    const cache = loadFromCache()
    if (cache[key]) {
      console.log('[Audio] Loading', key, 'from localStorage cache')
      const arrayBuffer = base64ToArrayBuffer(cache[key])
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
      audioBufferCache[key] = audioBuffer
      return audioBuffer
    }

    // Fetch from network
    console.log('[Audio] Fetching', key, 'from network:', url)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error('Network response was not ok: ' + response.status)
    }
    
    const arrayBuffer = await response.arrayBuffer()
    
    // Save to localStorage for future loads
    const base64Data = arrayBufferToBase64(arrayBuffer)
    saveToCache(key, base64Data)
    
    // Decode and cache in memory
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    audioBufferCache[key] = audioBuffer
    console.log('[Audio] Cached', key, 'in memory, duration:', audioBuffer.duration.toFixed(2) + 's')
    
    return audioBuffer
  } catch (err) {
    console.error('[Audio] Failed to fetch/cache', key + ':', err)
    return null
  }
}

/**
 * Play audio using Web Audio API (same pattern as CallAlertReceiver)
 */
async function playWithWebAudio(key, volume = 0.7) {
  const ctx = getAudioContext()
  if (!ctx) {
    console.warn('[Audio] No AudioContext available')
    return false
  }

  // Ensure AudioContext is unlocked
  await unlockAudioContextInternal()

  if (ctx.state !== 'running') {
    console.warn('[Audio] AudioContext not running, state:', ctx.state)
    return false
  }

  // Get audio buffer from cache or fetch
  let audioBuffer = audioBufferCache[key]
  if (!audioBuffer) {
    const url = SOUNDS[key]
    if (!url) {
      console.error('[Audio] Unknown sound key:', key)
      return false
    }
    audioBuffer = await fetchAndCacheAudio(key, url)
    if (!audioBuffer) {
      console.error('[Audio] Failed to load audio for:', key)
      return false
    }
  }

  return new Promise((resolve) => {
    try {
      // Create gain node for volume control
      const gainNode = ctx.createGain()
      gainNode.gain.value = volume
      gainNode.connect(ctx.destination)

      // Create buffer source
      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(gainNode)

      source.onended = () => {
        console.log('[Audio] Finished playing:', key)
        resolve(true)
      }

      source.start(0)
      console.log('[Audio] Started playing:', key)
    } catch (err) {
      console.error('[Audio] Playback error for', key + ':', err)
      resolve(false)
    }
  })
}

/**
 * Fallback: Play using HTML5 Audio element
 */
function playWithHTML5Audio(url, volume = 0.7) {
  return new Promise((resolve) => {
    try {
      const audio = new Audio(url)
      audio.volume = volume

      audio.onended = () => {
        console.log('[Audio] HTML5 Audio finished')
        resolve(true)
      }

      audio.onerror = (e) => {
        console.error('[Audio] HTML5 Audio error:', e)
        resolve(false)
      }

      const playPromise = audio.play()
      if (playPromise !== undefined) {
        playPromise
          .then(() => console.log('[Audio] HTML5 Audio started'))
          .catch((err) => {
            console.error('[Audio] HTML5 Audio play failed:', err)
            resolve(false)
          })
      }
    } catch (err) {
      console.error('[Audio] HTML5 Audio exception:', err)
      resolve(false)
    }
  })
}

/**
 * Main play function - tries Web Audio API first, then HTML5 Audio
 */
async function playSound(key, volume = 0.7) {
  if (typeof window === 'undefined') return false

  console.log('[Audio] Playing sound:', key)

  // Try Web Audio API first (more reliable)
  const webAudioResult = await playWithWebAudio(key, volume)
  if (webAudioResult) return true

  // Fallback to HTML5 Audio
  const url = SOUNDS[key]
  if (url) {
    console.log('[Audio] Falling back to HTML5 Audio for:', key)
    return playWithHTML5Audio(url, volume)
  }

  return false
}

// ============ PUBLIC API ============

/**
 * Unlock audio on user interaction (call this on first click/tap)
 * CRITICAL: Call this from click handlers before playing sounds
 */
export const unlockAudio = async () => {
  if (audioContextUnlocked) return true
  
  console.log('[Audio] Unlocking audio...')
  const result = await unlockAudioContextInternal()
  
  if (result) {
    console.log('[Audio] Audio unlocked successfully')
  } else {
    console.warn('[Audio] Failed to unlock audio')
  }
  
  return result
}

/**
 * Initialize and preload all audio files
 * Call this early in app lifecycle
 */
export const initAudio = async () => {
  if (typeof window === 'undefined') return

  console.log('[Audio] Initializing audio system...')

  // Set up unlock on first user interaction
  const unlockOnInteraction = async () => {
    await unlockAudio()
    document.removeEventListener('click', unlockOnInteraction)
    document.removeEventListener('touchstart', unlockOnInteraction)
    document.removeEventListener('keydown', unlockOnInteraction)
  }

  document.addEventListener('click', unlockOnInteraction)
  document.addEventListener('touchstart', unlockOnInteraction)
  document.addEventListener('keydown', unlockOnInteraction)

  // Preload all sounds in background
  const ctx = getAudioContext()
  if (ctx) {
    for (const [key, url] of Object.entries(SOUNDS)) {
      fetchAndCacheAudio(key, url).catch((err) => {
        console.warn('[Audio] Failed to preload', key + ':', err)
      })
    }
  }

  console.log('[Audio] Audio system initialized')
}

/**
 * Play login success sound
 */
export const playLoginSuccessSound = async () => {
  console.log('[Audio] >> playLoginSuccessSound called')
  return playSound('loginSuccess', 0.7)
}

/**
 * Play message notification sound (desktop only)
 */
export const playMessageNotificationSound = async () => {
  // Only play on desktop
  if (typeof window !== 'undefined' && window.innerWidth < 768) {
    console.log('[Audio] Skipping message notification on mobile')
    return false
  }
  console.log('[Audio] >> playMessageNotificationSound called')
  return playSound('messageNotification', 0.7)
}

/**
 * Play error notification sound
 */
export const playErrorSound = async () => {
  console.log('[Audio] >> playErrorSound called')
  return playSound('error', 0.6)
}

/**
 * Play general notification sound
 */
export const playNotificationSound = async () => {
  console.log('[Audio] >> playNotificationSound called')
  return playSound('notification', 0.7)
}

/**
 * Play success sound - for all success toasts and positive feedback
 */
export const playSuccessSound = async () => {
  console.log('[Audio] >> playSuccessSound called')
  return playSound('success', 0.7)
}

/**
 * Play task done sound - for task/project completion and approvals
 */
export const playTaskDoneSound = async () => {
  console.log('[Audio] >> playTaskDoneSound called')
  return playSound('taskDone', 0.8)
}

/**
 * Play game invite sound - for tic-tac-toe invitations
 */
export const playGameInviteSound = async () => {
  console.log('[Audio] >> playGameInviteSound called')
  return playSound('gameInvite', 0.8)
}

/**
 * Play message sent sound (Web Audio API beep)
 */
export const playMessageSentSound = () => {
  const ctx = getAudioContext()
  if (!ctx || ctx.state !== 'running') return

  try {
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)

    oscillator.frequency.value = 600
    oscillator.type = 'sine'

    gainNode.gain.setValueAtTime(0, ctx.currentTime)
    gainNode.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1)

    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + 0.1)
  } catch (err) {
    console.error('[Audio] Error playing message sent sound:', err)
  }
}
