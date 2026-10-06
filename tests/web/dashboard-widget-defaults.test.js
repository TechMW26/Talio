import { renderHook, act } from '@testing-library/react'
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets'
import { WIDGET_REGISTRY } from '@/lib/widgetRegistry'

test('only scrollable-list widgets opt into the taller minimum height', () => {
  const scrollable = ['employee-directory', 'leave-requests', 'leave-balance', 'goals-widget', 'project-tasks', 'announcements', 'holidays', 'today-tasks', 'learning-progress', 'recent-activity', 'my-assets', 'my-expenses', 'my-helpdesk', 'policies', 'role-news']
  expect(Object.values(WIDGET_REGISTRY).filter(widget => widget.scrollableList).map(widget => widget.id).sort()).toEqual(scrollable.sort())
  for (const id of ['check-in-out', 'attendance-summary', 'team-attendance', 'quick-actions', 'recent-activities']) {
    expect(WIDGET_REGISTRY[id].scrollableList).toBeUndefined()
  }
})

const available = ['check-in-out', 'attendance-summary', 'team-attendance', 'today-tasks']
const gridCells = ids => ids.reduce((sum, id) => sum + (['check-in-out', 'team-attendance'].includes(id) ? 2 : 1), 0)
beforeEach(() => localStorage.clear())

test('legacy layouts do not insert unrelated work widgets into attendance and respect removals', () => {
  localStorage.setItem('dashboard_widgets_config_test', JSON.stringify({ enabled: ['check-in-out', 'attendance-summary'], order: ['check-in-out', 'attendance-summary'] }))
  const { result, unmount } = renderHook(() => useDashboardWidgets('test', 'admin', available))
  expect(result.current.enabledWidgets).toHaveLength(2)
  expect(result.current.enabledWidgets[0]).toBe('check-in-out')
  act(() => result.current.removeWidget('attendance-summary'))
  unmount()
  const reopened = renderHook(() => useDashboardWidgets('test', 'admin', available))
  expect(reopened.result.current.enabledWidgets).toEqual(['check-in-out'])
})

test('fresh and reset defaults use available widgets without duplicating them', () => {
  const { result } = renderHook(() => useDashboardWidgets('fresh', 'admin', available))
  expect(gridCells(result.current.enabledWidgets) % 2).toBe(0)
  expect(result.current.enabledWidgets.every(id => available.includes(id))).toBe(true)
  expect(new Set(result.current.enabledWidgets).size).toBe(result.current.enabledWidgets.length)
  act(() => result.current.resetToDefaults())
  expect(gridCells(result.current.enabledWidgets) % 2).toBe(0)
})
