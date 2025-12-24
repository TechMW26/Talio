/**
 * Custom toast utility wrapper that adds sound effects
 * This wraps react-hot-toast to add audio feedback for notifications
 */

import hotToast from 'react-hot-toast'
import { playErrorSound, playSuccessSound, unlockAudio } from './audio'

/**
 * Custom toast wrapper with sound support
 * Wraps react-hot-toast and adds sounds for success and error notifications
 */
const toast = (message, options) => {
  return hotToast(message, options)
}

// Success toast with sound - plays for ALL success/approved/positive messages
toast.success = (message, options) => {
  // Play success sound asynchronously (don't block the toast)
  unlockAudio().then(() => {
    playSuccessSound().catch((err) => {
      console.warn('[Toast] Success sound failed:', err)
    })
  })
  return hotToast.success(message, options)
}

// Error toast with sound - plays for ALL error/denied/negative messages
toast.error = (message, options) => {
  // Play error sound asynchronously (don't block the toast)
  unlockAudio().then(() => {
    playErrorSound().catch((err) => {
      console.warn('[Toast] Error sound failed:', err)
    })
  })
  return hotToast.error(message, options)
}

// Loading toast (no sound)
toast.loading = (message, options) => {
  return hotToast.loading(message, options)
}

// Custom toast (no sound by default)
toast.custom = (render, options) => {
  return hotToast.custom(render, options)
}

// Promise toast (no sound - uses success/error internally)
toast.promise = (promise, messages, options) => {
  return hotToast.promise(promise, messages, options)
}

// Dismiss toast
toast.dismiss = (toastId) => {
  return hotToast.dismiss(toastId)
}

// Remove toast
toast.remove = (toastId) => {
  return hotToast.remove(toastId)
}

export default toast
export { toast }
