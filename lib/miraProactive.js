const hours = /^([01]\d|2[0-3]):([0-5]\d)$/
export const MIRA_PROACTIVE_DEFAULTS = Object.freeze({ enabled: false, meetings: true, tasks: true, messages: true, email: true, quietHoursEnabled: true, quietStart: '22:00', quietEnd: '08:00', timezone: 'Asia/Kolkata' })
export function sanitizeMiraProactive(value = {}) {
  const next = { ...MIRA_PROACTIVE_DEFAULTS }
  for (const key of ['enabled', 'meetings', 'tasks', 'messages', 'email', 'quietHoursEnabled']) if (typeof value?.[key] === 'boolean') next[key] = value[key]
  for (const key of ['quietStart', 'quietEnd']) if (hours.test(value?.[key] || '')) next[key] = value[key]
  try { if (typeof value?.timezone === 'string' && value.timezone.length < 80) { new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format(); next.timezone = value.timezone } } catch {}
  return next
}
export function miraQuietHours(value, now = new Date()) {
  const prefs = sanitizeMiraProactive(value)
  if (!prefs.quietHoursEnabled || prefs.quietStart === prefs.quietEnd) return false
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: prefs.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const time = `${parts.find(p => p.type === 'hour').value}:${parts.find(p => p.type === 'minute').value}`
  return prefs.quietStart < prefs.quietEnd ? time >= prefs.quietStart && time < prefs.quietEnd : time >= prefs.quietStart || time < prefs.quietEnd
}
export const miraEventId = value => String(value?._id || value || '')
const text = (value, max = 400) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : ''
const iso = value => Number.isFinite(+new Date(value)) ? new Date(value).toISOString() : null
const localLink = value => {
  if (typeof value !== 'string' || value.length > 240 || !/^\/dashboard(?:\/|\?|$)/.test(value) || /[\\\r\n]/.test(value)) return '/dashboard'
  try { const url = new URL(value, 'https://talio.invalid'); return url.origin === 'https://talio.invalid' && /^\/dashboard(?:\/|$)/.test(url.pathname) ? `${url.pathname}${url.search}${url.hash}` : '/dashboard' } catch { return '/dashboard' }
}

/** Convert verified, user-scoped records to facts, never inferred private events. */
export function buildMiraProactiveEvents({ notifications = [], tasks = [], meetings = [], mail = [] }, user, preferences, now = new Date()) {
  const prefs = sanitizeMiraProactive(preferences), own = miraEventId(user?._id), employee = miraEventId(user?.employeeId)
  const events = [], stamp = +now
  const add = value => events.push({ occurredAt: now.toISOString(), expiresAt: new Date(stamp + 86400000).toISOString(), priority: 'normal', readState: 'unread', confidence: 'recorded', ...value })
  for (const row of notifications) {
    if (miraEventId(row.user) !== own || row.read === true || row.isRead === true || stamp - +new Date(row.createdAt) > 7 * 86400000) continue
    const type = row.data?.type || row.type || '', reminder = type === 'mira-reminder'
    if (!reminder && (!prefs.enabled || !/chat|message|call|email|mail/.test(type) || (/mail/.test(type) ? !prefs.email : !prefs.messages))) continue
    add({ id: `notification:${miraEventId(row)}`, type: reminder ? 'reminder' : /call/.test(type) ? 'call' : /mail/.test(type) ? 'email' : 'message', source: 'talio-notifications', title: text(row.title, 120), summary: text(row.message), occurredAt: iso(row.createdAt), dueAt: reminder ? iso(row.data?.scheduledFor || row.createdAt) : null, priority: reminder ? 'high' : 'normal', link: localLink(row.url || row.link), reference: { collection: 'notifications', id: miraEventId(row) } })
  }
  if (!prefs.enabled) return events
  if (prefs.tasks) for (const row of tasks) {
    const due = +new Date(row.dueDate)
    if (!Number.isFinite(due) || row.isDeleted || row.deletedAt || ['done', 'completed', 'cancelled', 'archived'].includes(row.status) || due > stamp + 86400000 || due < stamp - 7 * 86400000) continue
    const overdue = due < stamp
    add({ id: `task:${miraEventId(row)}:${new Date(due).toISOString().slice(0, 10)}`, type: overdue ? 'task-overdue' : 'task-upcoming', source: 'talio-tasks', title: text(row.title, 120), summary: `${overdue ? 'Past its recorded due date' : 'Due in the next 24 hours'}${row.priority ? ` · ${text(row.priority, 30)} priority` : ''}.`, occurredAt: iso(row.updatedAt || row.createdAt || row.dueDate), dueAt: iso(row.dueDate), priority: overdue || row.priority === 'high' ? 'high' : 'normal', link: `/dashboard/projects/my-tasks?task=${encodeURIComponent(miraEventId(row))}`, reference: { collection: 'tasks', id: miraEventId(row) } })
  }
  if (prefs.meetings) for (const row of meetings) {
    const invite = (row.invitees || []).find(item => miraEventId(item.employee) === employee)
    if (!employee || (miraEventId(row.organizer) !== employee && !invite) || ['declined', 'rejected'].includes(invite?.status) || row.status === 'cancelled') continue
    const start = +new Date(row.scheduledStart), end = +new Date(row.actualEnd || row.scheduledEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const upcoming = start >= stamp && start <= stamp + 60 * 60000
    const followup = end <= stamp - 5 * 60000 && end >= stamp - 2 * 86400000
    if (!upcoming && !followup) continue
    const participantNote = (row.aiParticipantNotes || []).find(note => miraEventId(note.employee) === employee)
    const actionItems = (row.aiSummary?.actionItems || row.mom?.actionItems || []).filter(item => miraEventId(item.assignedTo) === employee).map(item => text(item.task || item.description || item.title, 180)).filter(Boolean).slice(0, 3)
    const summary = text(participantNote?.summary || row.aiSummary?.summary, 320)
    const segments = Array.isArray(row.transcript) ? row.transcript : []
    const transcriptExcerpt = !upcoming && !summary ? segments.slice(-12).map(segment => text(segment.text, 240)).filter(Boolean).join('\n').slice(0, 2400) : ''
    add({ id: `meeting:${miraEventId(row)}:${upcoming ? 'upcoming' : 'followup'}:${start}`, type: upcoming ? 'meeting-upcoming' : 'meeting-followup', source: 'talio-meetings', title: text(row.title, 120), summary: upcoming ? 'This meeting starts within the next hour.' : summary || 'The scheduled meeting has ended. A follow-up can ask how it went; attendance and outcomes are not inferred.', occurredAt: iso(row.updatedAt || row.createdAt || row.scheduledStart), dueAt: iso(row.scheduledStart), priority: upcoming ? 'high' : 'normal', link: `/dashboard/meetings/${encodeURIComponent(miraEventId(row))}`, reference: { collection: 'meetings', id: miraEventId(row) }, context: { recordedSummary: Boolean(summary), transcriptAvailable: segments.length > 0, actionItems, ...(transcriptExcerpt ? { transcriptExcerpt, transcriptPartial: true } : {}) } })
  }
  if (prefs.email) for (const row of mail) add({ id: `email:${row.accountId}:${row.id}`, type: 'email', source: 'connected-gmail', title: text(row.subject || 'Unread email', 120), summary: text(row.snippet, 240), occurredAt: iso(row.receivedAt), link: '/dashboard/mail', reference: { accountId: row.accountId, id: row.id } })
  return events.sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high') || +new Date(a.dueAt || a.occurredAt) - +new Date(b.dueAt || b.occurredAt)).slice(0, 12)
}
