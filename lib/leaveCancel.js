// Who may cancel a leave request, shared by the leave screen and the API.

const istDateKey = value => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/**
 * Employees can cancel their own leave while it is pending, or after approval
 * as long as it has not started yet (start date after today, India time).
 */
export function canEmployeeCancelLeave(leave, now = new Date()) {
  const status = String(leave?.status || '').toLowerCase()
  if (status === 'pending') return true
  if (status !== 'approved') return false
  const start = istDateKey(leave?.startDate)
  return Boolean(start) && start > istDateKey(now)
}
