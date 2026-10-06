// A transparent personal priority queue, not an AI or employee-worth score.
export const priorityLevel = value => ['urgent', 'critical', 'high'].includes(value) ? 'high' : value === 'low' ? 'low' : 'medium'

export function buildUpcomingReminders(tasks = [], meetings = [], now = new Date()) {
  const upcoming = (value) => value && Number.isFinite(+new Date(value)) && +new Date(value) >= +now
  return [
    ...(Array.isArray(tasks) ? tasks : []).filter(task => task?._id && !task.deletedAt && !['completed', 'approved', 'review', 'in-review', 'archived', 'cancelled', 'rejected'].includes(task.status) && upcoming(task.dueDate)).map(task => ({ id: `task-${task._id}`, title: task.title, at: task.dueDate, kind: 'Task deadline', priority: priorityLevel(task.priority), href: `/dashboard/projects/my-tasks?task=${encodeURIComponent(task._id)}` })),
    ...(Array.isArray(meetings) ? meetings : []).filter(meeting => meeting?._id && ['scheduled', 'in-progress'].includes(meeting.status) && !['rejected', 'declined'].includes(meeting.myInviteStatus) && upcoming(meeting.scheduledStart)).map(meeting => ({ id: `meeting-${meeting._id}`, title: meeting.title, at: meeting.scheduledStart, kind: 'Meeting', priority: priorityLevel(meeting.priority), href: `/dashboard/meetings/${encodeURIComponent(meeting._id)}` })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at) || a.id.localeCompare(b.id))
}

export function buildDayCompass(tasks = [], now = new Date(), timeZone = 'Asia/Kolkata') {
  const day = value => {
    const date = value ? new Date(value) : null
    if (!date || !Number.isFinite(+date)) return null
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  }
  const today = day(now)
  const available = (Array.isArray(tasks) ? tasks : []).filter(task => task && !task.deletedAt && !['archived', 'cancelled', 'rejected'].includes(task.status))
  const dueToday = available.filter(task => day(task.dueDate) === today)
  const open = available.filter(task => !['completed', 'approved', 'review', 'in-review'].includes(task.status))
  const overdue = task => Boolean(day(task.dueDate) && day(task.dueDate) < today)
  const priority = { critical: 0, urgent: 0, high: 1, medium: 2, low: 3 }
  const bucket = task => overdue(task) ? 0 : day(task.dueDate) === today ? 1 : ['in-progress', 'in_progress'].includes(task.status) ? 2 : 3
  const queue = [...open].sort((a, b) => bucket(a) - bucket(b) || (priority[a.priority] ?? 2) - (priority[b.priority] ?? 2) || (day(a.dueDate) || '9999').localeCompare(day(b.dueDate) || '9999') || String(a._id).localeCompare(String(b._id)))
  const completedToday = dueToday.filter(task => ['completed', 'approved'].includes(task.status)).length
  return {
    queue: queue.slice(0, 3).map(task => ({ ...task, reason: overdue(task) ? 'Overdue deadline' : day(task.dueDate) === today ? 'Due today' : ['in-progress', 'in_progress'].includes(task.status) ? 'Keep your momentum' : ['critical', 'urgent', 'high'].includes(task.priority) ? 'High-priority assignment' : 'Next available assignment' })),
    overdue: open.filter(overdue).length,
    dueToday: open.filter(task => day(task.dueDate) === today).length,
    inProgress: open.filter(task => ['in-progress', 'in_progress'].includes(task.status)).length,
    completedToday, totalToday: dueToday.length,
    progress: dueToday.length ? Math.round(completedToday / dueToday.length * 100) : 0,
  }
}
