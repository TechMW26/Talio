const MAX_OCCURRENCES = 120

function startOfDay(value) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

export function generateRecurringStarts(firstStart, recurrence = {}) {
  const first = new Date(firstStart)
  const until = new Date(recurrence.endDate)
  if (Number.isNaN(first.getTime()) || Number.isNaN(until.getTime()) || until < first) return []

  until.setHours(23, 59, 59, 999)
  const interval = Math.max(1, Math.min(52, Number(recurrence.interval) || 1))
  const pattern = recurrence.pattern || 'weekly'
  const starts = []

  if (pattern === 'weekly') {
    const weekdays = [...new Set((recurrence.daysOfWeek || [first.getDay()]).map(Number))]
      .filter(day => day >= 0 && day <= 6)
    const firstWeek = startOfDay(first)
    firstWeek.setDate(firstWeek.getDate() - firstWeek.getDay())
    const cursor = new Date(first)

    while (cursor <= until && starts.length < MAX_OCCURRENCES) {
      const cursorWeek = startOfDay(cursor)
      cursorWeek.setDate(cursorWeek.getDate() - cursorWeek.getDay())
      const weeksSinceFirst = Math.round((cursorWeek - firstWeek) / (7 * 24 * 60 * 60 * 1000))
      if (weeksSinceFirst % interval === 0 && weekdays.includes(cursor.getDay())) {
        starts.push(new Date(cursor))
      }
      cursor.setDate(cursor.getDate() + 1)
    }
  } else {
    const cursor = new Date(first)
    while (cursor <= until && starts.length < MAX_OCCURRENCES) {
      starts.push(new Date(cursor))
      if (pattern === 'daily') cursor.setDate(cursor.getDate() + interval)
      else if (pattern === 'biweekly') cursor.setDate(cursor.getDate() + (14 * interval))
      else cursor.setMonth(cursor.getMonth() + interval)
    }
  }

  if (!starts.some(date => date.getTime() === first.getTime())) starts.unshift(first)
  return starts.sort((a, b) => a - b).slice(0, MAX_OCCURRENCES)
}
