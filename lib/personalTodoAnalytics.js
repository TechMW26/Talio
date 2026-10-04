export function personalTodoAnalytics(all, categories, params, now = new Date()) {
  const period = params.get('period') || 'month'
  let start = null, end = now
  if (params.get('startDate') && params.get('endDate')) { start = new Date(params.get('startDate')); end = new Date(params.get('endDate')) }
  else if (period !== 'all') {
    const days = { week: 7, month: 30, year: 365 }[period]
    if (!days) throw Object.assign(new Error('Invalid analytics period'), { status: 400 })
    start = new Date(+now - days * 86400000)
  }
  if ((start && !Number.isFinite(+start)) || !Number.isFinite(+end) || (start && end < start)) throw Object.assign(new Error('Invalid date range'), { status: 400 })
  const rows = all.filter(row => (!start || new Date(row.createdAt) >= start) && new Date(row.createdAt) <= end)
  const completed = rows.filter(row => row.status === 'completed')
  const onTime = completed.filter(row => row.analytics?.completedOnTime === true).length, late = completed.filter(row => row.analytics?.completedOnTime === false).length
  const avg = field => { const values = completed.map(row => row.analytics?.[field]).filter(Number.isFinite); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 }
  const round = value => Math.round(value * 100) / 100
  const completionRate = rows.length ? completed.length / rows.length * 100 : 0, onTimeRate = onTime + late ? onTime / (onTime + late) * 100 : 0
  const trend = new Map(), categoryGroups = new Map(), priorities = {}
  const categoryMap = new Map(categories.map(c => [c._id, c]))
  for (const row of all) if (row.status === 'completed' && row.completedAt && new Date(row.completedAt) >= new Date(+now - 7 * 86400000)) { const key = new Date(row.completedAt).toISOString().slice(0, 10); trend.set(key, (trend.get(key) || 0) + 1) }
  for (const row of rows) {
    const key = row.category || null, category = categoryMap.get(key)
    const group = categoryGroups.get(key) || { _id: key, categoryId: key, categoryName: category?.name, categoryColor: category?.color, total: 0, completed: 0 }
    group.total++; if (row.status === 'completed') group.completed++
    categoryGroups.set(key, group)
    const priority = priorities[row.priority || 'none'] ||= { total: 0, completed: 0 }
    priority.total++; if (row.status === 'completed') priority.completed++
  }
  return {
    summary: { total: rows.length, completed: completed.length, pending: rows.filter(r => r.status === 'pending').length, inProgress: rows.filter(r => r.status === 'in_progress').length, highPriority: rows.filter(r => r.priority === 'high' && r.status !== 'completed').length, overdue: rows.filter(r => r.status !== 'completed' && r.dueDate && new Date(r.dueDate) < now).length, completionRate: round(completionRate), productivityScore: rows.length ? Math.round(completionRate * 0.6 + onTimeRate * 0.4) : 0 },
    analytics: { avgCompletionTimeHours: round(avg('completionTime')), onTimeCompletions: onTime, lateCompletions: late, onTimeRate: round(onTimeRate), avgDaysOverdue: round(avg('daysOverdue')), totalDueDateExtensions: completed.reduce((sum, row) => sum + Number(row.analytics?.dueDateExtensions || 0), 0) },
    trends: { completionTrend: [...trend].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })) },
    breakdown: { byCategory: [...categoryGroups.values()].map(group => ({ ...group, completionRate: group.completed / group.total * 100 })), byPriority: priorities }, period, dateRange: { start, end },
  }
}
