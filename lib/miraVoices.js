export const DEFAULT_MIRA_VOICE_ID = 'ftDdhfYtmfGP0tFlBYA1'
export const DEFAULT_MIRA_AGENT_VOICE_ID = 'ftDdhfYtmfGP0tFlBYA1'

// Preview and live calls share the same verified professional voice catalog.
// Retired/unknown saved choices fall back safely without overwriting preferences.
export function miraAgentVoice(voiceId) {
  const voice = MIRA_VOICES.find(voice => voice.id === voiceId) || MIRA_VOICES[0]
  return { voiceId: voice.id, voiceName: `${voice.name} · Indian`, notice: '' }
}

// Curated female voices. IDs are validated server-side before use.
export const MIRA_VOICES = [
  { id: DEFAULT_MIRA_AGENT_VOICE_ID, name: 'Alisha', description: 'Gentle, soft and engaging · default', accent: 'Indian' },
  { id: 'iWq9tCtTw1SYmVpvsRjY', name: 'Natasha', description: 'Professional, poised and direct', accent: 'Indian' },
  { id: '6JsmTroalVewG1gA6Jmw', name: 'Sia', description: 'Friendly, animated and conversational', accent: 'Indian' },
  { id: '6ZZR4JY6rOriLSDtV54M', name: 'Sreeja', description: 'Clear, relaxed and approachable', accent: 'Indian' },
  { id: 'XYfWcxd0jJece96Z98eV', name: 'Anushka', description: 'Calm, soothing and measured', accent: 'Indian' },
  { id: 'kL06KYMvPY56NluIQ72m', name: 'Varsha', description: 'Crisp, expressive storyteller', accent: 'Indian' },
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
