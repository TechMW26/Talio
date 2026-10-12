export const DEFAULT_MIRA_VOICE_ID = 'jJ0Hr51MaPgsgfPtFdR4'
export const DEFAULT_MIRA_AGENT_VOICE_ID = '9BWtsMINqrJLrRacOk9x'

// ElevenLabs disallows Instant Voice Clones on custom-LLM agents. These
// curated IVCs still work for ordinary TTS previews, not the live agent bridge.
export function miraAgentVoice(voiceId) {
  return ['jJ0Hr51MaPgsgfPtFdR4', 'komDQG4wp0wC5IDFwetv'].includes(voiceId)
    ? { voiceId: DEFAULT_MIRA_AGENT_VOICE_ID, notice: 'Live voice uses Aria: ElevenLabs does not allow instant-cloned voices with custom-LLM agents. Your selected clone remains available for previews.' }
    : { voiceId: isMiraVoiceId(voiceId) ? voiceId : DEFAULT_MIRA_AGENT_VOICE_ID, notice: '' }
}

// Curated female voices. IDs are validated server-side before use.
export const MIRA_VOICES = [
  { id: DEFAULT_MIRA_VOICE_ID, name: 'MIRA', description: 'Warm, clear and expressive', accent: 'Your selected MIRA voice' },
  { id: 'komDQG4wp0wC5IDFwetv', name: 'Mansi', description: 'A personal, natural-sounding voice', accent: 'Custom voice' },
  { id: '9BWtsMINqrJLrRacOk9x', name: 'Aria', description: 'Expressive, polished and confident', accent: 'American' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', description: 'Warm and conversational', accent: 'American' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Bright, smooth and articulate', accent: 'British' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Friendly, relaxed and clear', accent: 'American' },
]

export function isMiraVoiceId(value) {
  return MIRA_VOICES.some(voice => voice.id === value)
}

export function sanitizeMiraPreferences(value = {}) {
  return {
    voiceId: isMiraVoiceId(value.voiceId) ? value.voiceId : DEFAULT_MIRA_VOICE_ID,
    customInstructions: typeof value.customInstructions === 'string' ? value.customInstructions.slice(0, 1600) : '',
    knowledge: typeof value.knowledge === 'string' ? value.knowledge.slice(0, 8000) : '',
  }
}
