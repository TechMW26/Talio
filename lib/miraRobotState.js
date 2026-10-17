export const MIRA_ROBOT_COLORS = Object.freeze({ color: '#787878', trimColor: '#2a2c31', screenColor: '#e8f2ff' })
export const MIRA_ROBOT_SLEEP_MS = 60_000
export const MIRA_ROBOT_STATES = ['idle', 'thinking', 'searching', 'listening', 'speaking', 'working', 'happy', 'error', 'sleeping']

// Preserve the existing activity contract used by tools, voice and whiteboards.
export function miraRobotState(phase) {
  if (MIRA_ROBOT_STATES.includes(phase)) return phase
  return { breathing: 'idle', solving: 'thinking', connecting: 'thinking', composing: 'speaking', weaving: 'working', shaping: 'working' }[phase] || 'idle'
}

export function publishMiraRobotFeedback(state) {
  if (typeof window !== 'undefined' && ['happy', 'error', 'awake'].includes(state)) {
    window.dispatchEvent(new CustomEvent('mira:robot-feedback', { detail: { state } }))
  }
}
