// Date-only values must not drift when rendered on a device in another timezone.
export function calendarDateKey(value) {
  if (!value) return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  return Number.isNaN(+date) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function buildCalendarEvents({ holidays = [], birthdays = [], announcements = [], tasks = [] }, year) {
  const events = []
  const add = (type, row, date, title, href) => {
    const key = calendarDateKey(date)
    if (key) events.push({ id: `${type}-${row._id || title}-${key}`, type, date: key, title, href })
  }
  holidays.forEach(row => add('holiday', row, row.date, row.name, '/dashboard/holidays'))
  birthdays.forEach(row => {
    const birthday = calendarDateKey(row.dateOfBirth)
    if (birthday) for (const y of [year, year + 1]) {
      const date = `${y}-${birthday.slice(5)}`
      if (calendarDateKey(new Date(`${date}T12:00:00+05:30`)) === date) add('birthday', row, date, `${[row.firstName, row.lastName].filter(Boolean).join(' ')}'s birthday`, null)
    }
  })
  // Only explicitly scheduled announcements belong in Coming Up, not their publish date.
  announcements.forEach(row => add('announcement', row, row.eventDate || row.date || row.createdAt, row.title, '/dashboard/announcements'))
  tasks.forEach(row => add('task', row, row.dueDate, row.title || row.name, row.project?._id ? `/dashboard/projects/${row.project._id}` : '/dashboard/projects'))
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
}
