import { groupDashboardWidgets, isWideDashboardWidget, balanceDashboardWidgets } from '@/lib/dashboardSections'

test('every selected widget appears once, including unknown future widgets', () => {
  const widgets = ['salary-slip', 'today-tasks', 'announcements', 'quick-glance', 'check-in-out', 'future-widget'].map(id => ({ id }))
  const groups = groupDashboardWidgets(widgets)
  const rendered = groups.flatMap(group => group.widgets)
  expect(rendered).toHaveLength(widgets.length)
  expect(new Set(rendered.map(widget => widget.id))).toEqual(new Set(widgets.map(widget => widget.id)))
  expect(groups[0].widgets[0].id).toBe('check-in-out')
  expect(groups.at(-1).widgets.map(widget => widget.id)).toEqual(['salary-slip', 'future-widget'])
})

test('saved order is preserved inside work sections and empty sections are omitted', () => {
  const widgets = ['active-projects', 'today-tasks', 'pending-approvals'].map(id => ({ id }))
  expect(groupDashboardWidgets(widgets)).toEqual([expect.objectContaining({ id: 'work', widgets })])
  expect(groupDashboardWidgets([])).toEqual([])
})

test('profile and punch row and team attendance span both grid cells', () => {
  expect(isWideDashboardWidget('team-attendance')).toBe(true)
  expect(isWideDashboardWidget('project-tasks')).toBe(false)
  expect(isWideDashboardWidget('check-in-out')).toBe(true)
  expect(isWideDashboardWidget('quick-glance')).toBe(false)
  expect(isWideDashboardWidget('attendance-summary')).toBe(false)
})

test('attendance is below full-width team attendance with tasks alongside', () => {
  const widgets = ['today-tasks', 'attendance-summary', 'check-in-out', 'team-attendance'].map(id => ({ id }))
  expect(groupDashboardWidgets(widgets)[0].widgets.map(w => w.id)).toEqual(['check-in-out', 'team-attendance', 'attendance-summary', 'today-tasks'])
})

test('adds an available task fallback only beside monthly attendance', () => {
  const task = { id: 'today-tasks' }
  expect(groupDashboardWidgets([{ id: 'attendance-summary' }], task)[0].widgets).toEqual([{ id: 'attendance-summary' }, task])
  expect(groupDashboardWidgets([{ id: 'team-attendance' }], task)[0].widgets).toEqual([{ id: 'team-attendance' }])
})

test('balances odd sections with available related widgets without duplicates', () => {
  const widgets = ['check-in-out', 'today-tasks', 'announcements', 'holidays'].map(id => ({ id }))
  const candidates = ['check-in-out', 'quick-glance', 'active-projects', 'birthday-widget'].map(id => ({ id }))
  const balanced = balanceDashboardWidgets(widgets, candidates)
  expect(balanced.map(w => w.id)).toEqual([...widgets.map(w => w.id), 'active-projects'])
  expect(balanceDashboardWidgets(balanced, candidates)).toEqual(balanced)
  expect(balanceDashboardWidgets(widgets, [])).toEqual(widgets)
})
