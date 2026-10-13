export const MIRA_ORB_STATES = ['working', 'searching', 'solving', 'listening', 'connecting', 'weaving', 'composing', 'breathing', 'shaping']

export function miraOrbVoiceState(state) {
  return { idle: 'breathing', loading: 'connecting', listening: 'listening', speaking: 'composing', working: 'working', searching: 'searching' }[state] || 'breathing'
}

export function miraOrbRequestState(text = '', { attachments = false, multiStep = false } = {}) {
  if (attachments || multiStep) return 'weaving'
  if (/\b(draw|design|generate.{0,20}image|create.{0,20}(document|whiteboard))\b/i.test(text)) return 'shaping'
  if (/\b(write|draft|compose|rewrite|email|message)\b/i.test(text)) return 'composing'
  if (/\b(search|find|look up|fetch|show|list|attendance|pending tasks)\b/i.test(text)) return 'searching'
  return 'solving'
}

export function miraOrbActionState(type = '') {
  if (/^(generate_image|create_document|whiteboard)/.test(type)) return 'shaping'
  if (/^(lookup_|read_|search_|get_)/.test(type)) return 'searching'
  if (/^(create_project|invite_|assign_task|schedule_reminder)/.test(type)) return 'weaving'
  if (/^(create_task|create_meeting|send_message|quick_note)/.test(type)) return 'composing'
  return 'working'
}

export function publishMiraOrbState(source, state) {
  if (typeof window !== 'undefined' && MIRA_ORB_STATES.includes(state)) window.dispatchEvent(new CustomEvent('mira:orb-state', { detail: { source, state } }))
}
