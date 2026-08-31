function isDesktopAudioDisabled() {
  if (typeof window === 'undefined') return false
  return Boolean(window.__TALIO_AUDIO_DISABLED__)
}

export function isMeetingAudioUploadSupported() {
  if (typeof window === 'undefined') return false

  return Boolean(
    typeof MediaRecorder !== 'undefined'
    && typeof FormData !== 'undefined'
    && typeof Blob !== 'undefined'
  )
}

export function getMeetingTranscriptionMode() {
  const canUseCloudTranscription = isMeetingAudioUploadSupported()

  if (canUseCloudTranscription) {
    return 'pollinations'
  }

  return 'unsupported'
}
export function getMeetingTranscriptionUnavailableReason() {
  if (getMeetingTranscriptionMode() !== 'unsupported') {
    return ''
  }

  if (typeof window === 'undefined') {
    return 'Mira live transcription is only available in the browser.'
  }

  if (isDesktopAudioDisabled()) {
    return 'Mira live transcription is unavailable in this Talio Desktop environment.'
  }

  if (typeof MediaRecorder === 'undefined') {
    return 'This browser does not support microphone capture for Mira live transcription.'
  }

  if (typeof FormData === 'undefined' || typeof Blob === 'undefined') {
    return 'This browser cannot upload recorded audio for Mira live transcription.'
  }

  return 'Mira live transcription is unavailable in this browser environment.'
}

export function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') {
    return null
  }

  const preferredTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ]

  return preferredTypes.find(type => MediaRecorder.isTypeSupported(type)) || ''
}
