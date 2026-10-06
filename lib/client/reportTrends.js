import { calendarDateKey } from './calendarEvents'

// Only observed days, not invented zeroes for unobserved historical days.
export function attendanceReportTrend(records = []) {
  const days = new Map()
  for (const record of records) {
    const date = calendarDateKey(record.date)
    if (!date) continue
    const row = days.get(date) || { date, records: 0, present: 0, late: 0, hours: 0 }
    row.records += 1
    if (['present', 'in-progress', 'work-from-home', 'wfh'].includes(record.status)) row.present += 1
    if (record.status === 'half-day') row.present += .5
    if (record.checkInStatus === 'late') row.late += 1
    row.hours += Math.max(0, Number(record.workHours) || 0)
    days.set(date, row)
  }
  return [...days.values()].sort((a,b) => a.date.localeCompare(b.date)).map(row => ({ ...row, attendanceRate: Math.round(row.present / row.records * 100), hours: Math.round(row.hours * 10) / 10 }))
}

export function completedTaskTrend(tasks = [], startDate, endDate) {
  const days = new Map()
  for (const task of tasks) {
    if (!['completed', 'done', 'completed-pending-approval'].includes(task.status)) continue
    const date = calendarDateKey(task.completedAt)
    if (!date || (startDate && date < startDate) || (endDate && date > endDate)) continue
    const row = days.get(date) || { date, completed: 0 }
    row.completed += 1
    days.set(date, row)
  }
  return [...days.values()].sort((a,b) => a.date.localeCompare(b.date))
}
