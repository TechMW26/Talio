import { render, screen, fireEvent } from '@testing-library/react'
import fs from 'fs'
import path from 'path'
import CustomizableDashboard from '@/components/dashboard/CustomizableDashboard'

const mockWidgets = ['check-in-out', 'team-attendance', 'attendance-summary', 'today-tasks', 'quick-glance', 'leave-balance', 'announcements', 'my-assets'].map(id => ({ id, name: id }))
jest.mock('framer-motion', () => ({ useReducedMotion: () => false, motion: { span: ({ layoutId, transition, ...props }) => <span {...props} /> } }))
jest.mock('@/components/dashboard/ActionableInsights', () => ({ __esModule: true, default: () => <div>Existing productivity tools</div> }))
const widgets = Object.fromEntries(mockWidgets.map(widget => [widget.id, <div key={widget.id}>Widget {widget.id}</div>]))

test('category pills and bounded panels keep all selected information reachable', () => {
  render(<CustomizableDashboard userId="u" userRole="admin" displayName="Aviraj" widgetComponents={widgets} />)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Aviraj')
  expect(screen.getByText('Widget check-in-out')).toBeTruthy()
  expect(screen.queryByText('Widget announcements')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Next widget panel' }))
  expect(screen.getByText('Widget team-attendance')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Next widget panel' }))
  expect(screen.getByText('Widget attendance-summary')).toBeTruthy()
  expect(screen.queryByText('Widget today-tasks')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Work & approvals' }))
  expect(screen.getByText('Widget today-tasks')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'People & updates' }))
  expect(screen.getByText('Widget announcements')).toBeTruthy()
  expect(screen.getByRole('tab', { name: 'People & updates' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(screen.getByRole('tab', { name: 'People & updates' }), { key: 'End' })
  expect(screen.getByText('Widget my-assets')).toBeTruthy()
})

test('quick tools share the heading top line and widget bottom within the same workspace', () => {
  render(<CustomizableDashboard userId="u" widgetComponents={widgets} />)
  const tools = screen.getByRole('complementary', { name: 'Quick tools' })
  const main = screen.getByRole('heading', { level: 1 }).closest('[data-dashboard-widget-area]')
  expect(main).not.toBeNull()
  expect(main.parentElement).toBe(tools.parentElement)
  expect(main.firstElementChild.tagName).toBe('HEADER')
  expect(main.contains(screen.getByRole('tablist', { name: 'Dashboard categories' }))).toBe(true)
})

test('fixed dashboard enables available widgets without customization or dragging', () => {
  render(<CustomizableDashboard userId="u" widgetComponents={widgets} />)
  expect(screen.queryByRole('button', { name: 'Customize' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Add widget' })).toBeNull()
  const source = fs.readFileSync('components/dashboard/CustomizableDashboard.js', 'utf8')
  expect(source).toContain('getWidgetsForRole(effectiveRole).filter(widget => widgetComponents[widget.id])')
  for (const removed of ['DndContext', 'useDashboardWidgets', 'DraggableWidget', 'AddWidgetModal']) expect(source).not.toContain(removed)
  expect(screen.getByText('Page 1 of 3')).toBeTruthy()
})

test('named page pills jump directly to a panel and mark the active page', () => {
  render(<CustomizableDashboard userRole="admin" widgetComponents={widgets} />)
  const first = screen.getByRole('button', { name: /^Go to widget page 1:/ })
  const last = screen.getByRole('button', { name: /^Go to widget page 4:/ })
  expect(first.textContent).toBe('Check In/Out')
  expect(last.textContent).toBe('Leave Balance')
  expect(screen.getByRole('button', { name: /^Go to widget page 3:/ }).textContent).toBe('Attendance Summary + Quick Glance')
  expect(first.getAttribute('aria-current')).toBe('page')
  expect(last.hasAttribute('aria-current')).toBe(false)
  fireEvent.click(last)
  expect(screen.getByText('Widget leave-balance')).toBeTruthy()
  expect(screen.queryByText('Widget check-in-out')).toBeNull()
  expect(last.getAttribute('aria-current')).toBe('page')
  expect(first.hasAttribute('aria-current')).toBe(false)
  expect(screen.getByText('Page 4 of 4')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Next widget panel' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('tab', { name: 'People & updates' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Attendance & time' }))
  expect(screen.getByText('Page 1 of 4')).toBeTruthy()
  expect(screen.getByRole('button', { name: /^Go to widget page 1:/ }).getAttribute('aria-current')).toBe('page')
})

test('home bottom clearance comes only from the shell and pagination stays bounded', () => {
  const layout = fs.readFileSync('app/dashboard/dashboard-layout.css', 'utf8')
  expect(layout).toContain('.dashboard-content-frame:has([data-page-sizing="viewport"]):has([data-dashboard-home]) { padding-bottom: 0; }')
  expect(layout).toContain('padding: var(--dashboard-shell-inset)')
  expect(layout).toContain('calc(76px + env(safe-area-inset-bottom))')
  expect(fs.readFileSync('components/dashboards/UnifiedDashboard.js', 'utf8').match(/data-dashboard-home/g)).toHaveLength(2)
  expect(fs.readFileSync('app/dashboard/page.js', 'utf8')).toContain('data-dashboard-home')
  const css = fs.readFileSync('components/dashboard/HomeDashboard.module.css', 'utf8')
  expect(css).toContain('.pagePills button[aria-current="page"] { background: #2563eb;')
  const pills = css.match(/\.pagePills\s*\{([^}]+)\}/)[1]
  expect(pills).toContain('max-width: none;')
  expect(pills).toContain('min-width: 0;')
  expect(pills).toContain('overflow-x: auto;')
  expect(css.match(/\.pagination\s*\{([^}]+)\}/)[1]).toContain('max-width: 100%;')
  expect(css.match(/\.panelHeader\s*\{([^}]+)\}/)[1]).toContain('flex-wrap: wrap;')
  expect(css).not.toContain('max-width: 40vw')
})

test('all dashboard pages share compact top clearance at every breakpoint', () => {
  const layout = fs.readFileSync('app/dashboard/dashboard-layout.css', 'utf8')
  expect(layout.match(/--dashboard-gutter-top:\s*[^;]+;/g)).toEqual(['--dashboard-gutter-top: 8px;'])
  expect(layout).toContain('padding: var(--dashboard-gutter-top) var(--dashboard-gutter-x) var(--dashboard-gutter-bottom);')
  const css = fs.readFileSync('components/dashboard/HomeDashboard.module.css', 'utf8')
  expect(css.match(/\.header\s*\{([^}]+)\}/)[1]).toContain('margin-bottom: 8px;')
  expect(css).not.toContain('margin-bottom: 18px;')
})

test('role restrictions still exclude admin-only widgets', () => {
  render(<CustomizableDashboard userRole="employee" widgetComponents={widgets} />)
  fireEvent.click(screen.getByRole('button', { name: 'Next widget panel' }))
  expect(screen.queryByText('Widget team-attendance')).toBeNull()
})

test('department heads retain their existing management widgets', () => {
  render(<CustomizableDashboard userRole="department_head" widgetComponents={widgets} />)
  fireEvent.click(screen.getByRole('button', { name: 'Next widget panel' }))
  expect(screen.getByText('Widget team-attendance')).toBeTruthy()
})

test('dashboard has full-height rows, contained overflow and reduced-motion support', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'components/dashboard/HomeDashboard.module.css'), 'utf8')
  expect(css).toContain('height: 100%; min-height: 0')
  expect(css).toContain('grid-template-rows: minmax(0, 1fr)')
  expect(css).not.toContain('grid-template-rows: repeat(2, minmax(0, 1fr))')
  expect(css).toContain('overflow: hidden')
  expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  expect(css).not.toContain(':hover')
})

test('widgets and quick tools stretch to a shared bottom edge without extra stage padding', () => {
  const css = fs.readFileSync('components/dashboard/HomeDashboard.module.css', 'utf8')
  const workspace = css.match(/\.workspace\s*\{([^}]+)\}/)[1]
  const slide = css.match(/\.slide\s*\{([^}]+)\}/)[1]
  expect(workspace).toContain('grid-template-rows: minmax(0, 1fr)')
  expect(workspace).toContain('align-items: stretch')
  expect(slide).toContain('padding: 0')
  const punchCss = fs.readFileSync('components/widgets/CheckInOutWidget.module.css', 'utf8')
  expect(punchCss).toContain('.punches:has(> .location:empty) { grid-template-rows: auto minmax(180px, 1fr); }')
  expect(punchCss.match(/\.layout\s*\{([^}]+)\}/)[1]).toContain('grid-template-rows: minmax(0, 1fr);')
})
