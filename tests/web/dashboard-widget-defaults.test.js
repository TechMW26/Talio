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

test('upgrades an old odd saved grid once and respects later removals', () => {
  localStorage.setItem('dashboard_widgets_config_test', JSON.stringify({ enabled: ['check-in-out', 'attendance-summary'], order: ['check-in-out', 'attendance-summary'] }))
  const { result, unmount } = renderHook(() => useDashboardWidgets('test', 'admin', available))
  expect(result.current.enabledWidgets).toHaveLength(3)
  expect(result.current.enabledWidgets[0]).toBe('check-in-out')
  const added = result.current.enabledWidgets[2]
  act(() => result.current.removeWidget(added))
  unmount()
  const reopened = renderHook(() => useDashboardWidgets('test', 'admin', available))
  expect(reopened.result.current.enabledWidgets).toEqual(['check-in-out', 'attendance-summary'])
})

test('fresh and reset defaults use available widgets without duplicating them', () => {
  const { result } = renderHook(() => useDashboardWidgets('fresh', 'admin', available))
  expect(gridCells(result.current.enabledWidgets) % 2).toBe(0)
  expect(result.current.enabledWidgets.every(id => available.includes(id))).toBe(true)
  expect(new Set(result.current.enabledWidgets).size).toBe(result.current.enabledWidgets.length)
  act(() => result.current.resetToDefaults())
  expect(gridCells(result.current.enabledWidgets) % 2).toBe(0)
})
