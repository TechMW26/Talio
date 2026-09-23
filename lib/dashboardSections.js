// Sections provide predictable placement while preserving saved order within each group.
const SECTIONS = [
  { id: 'attendance', title: 'Attendance & time', description: 'Your check-in, daily status and attendance overview.', ids: ['check-in-out', 'quick-glance', 'attendance-summary', 'team-attendance', 'leave-balance'] },
  { id: 'work', title: 'Work & approvals', description: 'Tasks, projects and requests that need your attention.', ids: ['today-tasks', 'project-tasks', 'active-projects', 'project-timeline', 'pending-approvals', 'leave-requests', 'reviews-pending', 'goals-widget', 'helpdesk-tickets', 'travel-requests'] },
  { id: 'people', title: 'People & updates', description: 'Company news, your team and upcoming events.', ids: ['announcements', 'notifications-feed', 'employee-directory', 'new-employees', 'birthday-widget', 'work-anniversary', 'team-calendar', 'holidays', 'recent-activities'] },
  { id: 'overview', title: 'Reports & workspace', description: 'Performance, finances and your remaining selected widgets.', ids: [] },
]

export function groupDashboardWidgets(widgets, taskFallback = null) {
  const arranged = [...widgets]
  const hasAttendance = arranged.some(widget => widget.id === 'attendance-summary')
  let task = hasAttendance && (arranged.find(widget => widget.id === 'today-tasks') || arranged.find(widget => widget.id === 'project-tasks') || taskFallback)
  if (task && !arranged.some(widget => widget.id === task.id)) arranged.push(task)
  const groups = SECTIONS.map(section => ({ ...section, widgets: [] }))
  for (const widget of arranged) {
    const target = widget.id === task?.id ? groups[0] : groups.find(group => group.ids.includes(widget.id)) || groups[groups.length - 1]
    target.widgets.push(widget)
  }
  // Punch controls stay first even when older saved layouts put them last.
  const priority = ['check-in-out', 'team-attendance', 'attendance-summary', task?.id]
  const rank = id => priority.includes(id) ? priority.indexOf(id) : priority.length
  groups[0].widgets.sort((a, b) => rank(a.id) - rank(b.id))
  return groups.filter(group => group.widgets.length)
}

export function isWideDashboardWidget(id) {
  return id === 'check-in-out' || id === 'team-attendance'
}

export function balanceDashboardWidgets(widgets, candidates) {
  const result = [...widgets]
  const seen = new Set(widgets.map(widget => widget.id))
  for (const section of groupDashboardWidgets(widgets)) {
    const cells = section.widgets.reduce((sum, widget) => sum + (isWideDashboardWidget(widget.id) ? 2 : 1), 0)
    if (cells % 2 === 0) continue
    const next = candidates.find(widget => !seen.has(widget.id) && !isWideDashboardWidget(widget.id) && groupDashboardWidgets([...result, widget]).find(group => group.id === section.id)?.widgets.some(item => item.id === widget.id))
    if (next) { result.push(next); seen.add(next.id) }
  }
  return result
}
