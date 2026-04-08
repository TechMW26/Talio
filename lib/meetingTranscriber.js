import { detectMeetingLanguage, normalizeMeetingLanguage } from './meetingLanguage.js'

let meetingTranscriberPromise = null

function getAudioContextConstructor() {
  if (typeof window === 'undefined') return null
  return window.AudioContext || window.webkitAudioContext || null
}

function getSpeechRecognitionConstructor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

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

function hasRequiredAudioContextMethods(audioContext) {
  return Boolean(
    audioContext
    && typeof audioContext.createMediaStreamSource === 'function'
    && typeof audioContext.createAnalyser === 'function'
    && typeof audioContext.decodeAudioData === 'function'
  )
}

export function isMeetingTranscriptionSupported() {
  if (typeof window === 'undefined') return false
  if (isDesktopAudioDisabled()) return false
  if (typeof MediaRecorder === 'undefined') return false

  const AudioContextCtor = getAudioContextConstructor()
  if (!AudioContextCtor) return false

  let audioContext = null

  try {
    audioContext = new AudioContextCtor()
    return hasRequiredAudioContextMethods(audioContext)
  } catch {
    return false
  } finally {
    if (audioContext && typeof audioContext.close === 'function' && audioContext.state !== 'closed') {
      audioContext.close().catch(() => {})
    }
  }
}

export function isMeetingSpeechRecognitionSupported() {
  const SpeechRecognitionCtor = getSpeechRecognitionConstructor()
  return typeof SpeechRecognitionCtor === 'function'
}

export function getMeetingTranscriptionMode(options = {}) {
  const { preferCloud = false } = options

  const canUseLocalWhisper = isMeetingTranscriptionSupported()
  const canUseCloudTranscription = isMeetingAudioUploadSupported()

  if (preferCloud && canUseCloudTranscription) {
    return 'elevenlabs'
  }

  if (canUseLocalWhisper) {
    return 'whisper'
  }

  if (canUseCloudTranscription) {
    return 'elevenlabs'
  }

  if (isMeetingSpeechRecognitionSupported()) {
    return 'speech-recognition'
  }

  return 'unsupported'
}

export function createMeetingSpeechRecognition() {
  const SpeechRecognitionCtor = getSpeechRecognitionConstructor()

  if (typeof SpeechRecognitionCtor !== 'function') {
    throw new Error('Speech recognition is not available in this browser')
  }

  return new SpeechRecognitionCtor()
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
    return 'This browser does not support local audio capture for Mira live transcription.'
  }

  if (typeof FormData === 'undefined' || typeof Blob === 'undefined') {
    return 'This browser cannot upload recorded audio for Mira live transcription.'
  }

  return 'Mira live transcription is unavailable in this browser environment.'
}

export function resetMeetingTranscriber() {
  meetingTranscriberPromise = null
}

function downsampleAudio(channelData, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) {
    return channelData
  }

  const ratio = inputSampleRate / outputSampleRate
  const outputLength = Math.round(channelData.length / ratio)
  const result = new Float32Array(outputLength)

  let offsetResult = 0
  let offsetBuffer = 0

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio)
    let accumulator = 0
    let count = 0

    for (let index = offsetBuffer; index < nextOffsetBuffer && index < channelData.length; index += 1) {
      accumulator += channelData[index]
      count += 1
    }

    result[offsetResult] = count > 0 ? accumulator / count : 0
    offsetResult += 1
    offsetBuffer = nextOffsetBuffer
  }

  return result
}

function mergeToMono(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0)
  }

  const leftChannel = audioBuffer.getChannelData(0)
  const rightChannel = audioBuffer.getChannelData(1)
  const mixed = new Float32Array(audioBuffer.length)

  for (let index = 0; index < audioBuffer.length; index += 1) {
    mixed[index] = (leftChannel[index] + rightChannel[index]) / 2
  }

  return mixed
}

export async function getMeetingTranscriber(progressCallback) {
  // Only runs in browser — never on the server
  if (typeof window === 'undefined') {
    throw new Error('getMeetingTranscriber can only be called in the browser')
  }

  if (!isMeetingTranscriptionSupported()) {
    throw new Error(getMeetingTranscriptionUnavailableReason())
  }

  if (!meetingTranscriberPromise) {
    meetingTranscriberPromise = (async () => {
      const { env, pipeline } = await import('@xenova/transformers')

      env.allowLocalModels = false
      env.useBrowserCache = true
      env.backends.onnx.wasm.numThreads = 1

      return pipeline(
        'automatic-speech-recognition',
        process.env.NEXT_PUBLIC_MEETING_TRANSCRIBER_MODEL || 'Xenova/whisper-tiny',
        {
          quantized: true,
          progress_callback: progressCallback,
        }
      )
    })().catch(error => {
      meetingTranscriberPromise = null
      throw error
    })
  }

  return meetingTranscriberPromise
}

export async function blobToAudioFloat32Array(blob, sampleRate = 16000) {
  if (!isMeetingTranscriptionSupported()) {
    throw new Error(getMeetingTranscriptionUnavailableReason())
  }

  const AudioContextCtor = getAudioContextConstructor()
  if (!AudioContextCtor) {
    throw new Error('AudioContext is not available in this browser')
  }

  const audioContext = new AudioContextCtor()

  if (!hasRequiredAudioContextMethods(audioContext)) {
    if (typeof audioContext.close === 'function' && audioContext.state !== 'closed') {
      await audioContext.close().catch(() => {})
    }
    throw new Error(getMeetingTranscriptionUnavailableReason())
  }

  try {
    const sourceBuffer = await blob.arrayBuffer()
    const decodedAudio = await audioContext.decodeAudioData(sourceBuffer.slice(0))
    const mono = mergeToMono(decodedAudio)
    return downsampleAudio(mono, decodedAudio.sampleRate, sampleRate)
  } finally {
    if (audioContext.state !== 'closed') {
      await audioContext.close().catch(() => {})
    }
  }
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

export function normalizeWhisperTranscript(result, options = {}) {
  const {
    fallbackStartedAt = Date.now(),
    segmentIdPrefix = `meeting-${Date.now()}`,
    fallbackLanguage = 'en',
  } = options

  const baseTimestamp = new Date(fallbackStartedAt).getTime()
  const rawChunks = Array.isArray(result?.chunks) && result.chunks.length > 0
    ? result.chunks
    : [{ text: result?.text || '', timestamp: [0, 0] }]

  return rawChunks
    .map((chunk, index) => {
      const text = String(chunk?.text || '').trim()
      if (!text) return null

      const startSeconds = Array.isArray(chunk?.timestamp)
        ? Number(chunk.timestamp[0] || 0)
        : 0
      const endSeconds = Array.isArray(chunk?.timestamp)
        ? Number(chunk.timestamp[1] || startSeconds)
        : startSeconds

      const startOffsetMs = Math.max(0, Math.round(startSeconds * 1000))
      const endOffsetMs = Math.max(startOffsetMs, Math.round(endSeconds * 1000))
      const language = normalizeMeetingLanguage(
        chunk?.language || detectMeetingLanguage(text, fallbackLanguage)
      )

      return {
        segmentId: `${segmentIdPrefix}-${index}`,
        text,
        timestamp: new Date(baseTimestamp + startOffsetMs).toISOString(),
        startOffsetMs,
        endOffsetMs,
        language,
        source: 'live-whisper',
      }
    })
    .filter(Boolean)
}
