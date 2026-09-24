let focusTimerHandler = null
export function matchMiraFocusTimer(message) {
  const text = String(message || '').trim().replace(/[.!?]+$/, '')
  const match = text.match(/^(?:please\s+)?(start|pause|resume|reset|dismiss)\s+(?:my |the |a )?(?:focus |pomodoro )timer(?:\s+for\s+(\d+)\s+(?:minutes?|mins?))?$/i)
    || text.match(/^(?:please\s+)?(?:focus |pomodoro )timer\s+(start|pause|resume|reset|dismiss)(?:\s+karo)?(?:\s+(\d+)\s+minutes?)?$/i)
  if (!match) return null
  return validateMiraFocusTimer({ type: 'focus_timer', fields: { operation: match[1].toLowerCase(), ...(match[2] ? { minutes: Number(match[2]) } : {}) } })
}
export function registerMiraFocusTimer(handler) {
  focusTimerHandler = handler
  return () => { if (focusTimerHandler === handler) focusTimerHandler = null }
}
export function validateMiraFocusTimer(action) {
  if (action?.type !== 'focus_timer' || !['start', 'pause', 'resume', 'reset', 'dismiss'].includes(action.fields?.operation)) return null
  const { operation, minutes } = action.fields
  if (minutes !== undefined && (operation !== 'start' || !Number.isInteger(minutes) || minutes < 1 || minutes > 180)) return null
  return { type: 'focus_timer', fields: { operation, ...(minutes === undefined ? {} : { minutes }) } }
}
export function executeMiraFocusTimer(action, { signal } = {}) {
  const valid = validateMiraFocusTimer(action)
  if (!valid || signal?.aborted || !focusTimerHandler) return { success: false, message: 'The focus timer is unavailable in this session. Open Dashboard → Quick Tools.' }
  const result = focusTimerHandler(valid.fields)
  window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: result.message, phase: 'done', target: document.querySelector('[data-mira-focus-timer]') } }))
  return result
}
