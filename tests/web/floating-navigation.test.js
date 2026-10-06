import fs from 'node:fs'
import path from 'node:path'
const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

test('header shares equal padding on every edge in loading and ready states', () => {
  const css = read('app/dashboard/dashboard-layout.css')
  const header = read('components/Header.js')
  expect(css).toContain('--dashboard-header-inset: 10px')
  expect(css).toContain('padding: var(--dashboard-header-inset)')
  expect(css).toContain('--dashboard-header-control-height: 42px')
  expect(header.match(/talio-navigation-header-row flex items-center justify-between/g)).toHaveLength(2)
  expect(header).not.toContain('px-1 sm:px-4 lg:px-6 h-[60.5px]')
  expect(header).not.toContain('group -ml-3')
})

test('floating surfaces share one geometry source without changing header controls', () => {
  const css = read('app/dashboard/dashboard-layout.css')
  expect(read('app/dashboard/layout.js')).toContain('dashboard-floating-shell flex h-screen')
  expect(css).toContain('--dashboard-shell-inset: 12px')
  expect(css).toContain('.dashboard-floating-shell .talio-navigation-header')
  expect(css).toContain('margin-bottom: 12px')
  expect(css).toContain('.talio-floating-rail, .talio-floating-expanded, .talio-floating-mobile-sidebar')
  expect(css).toContain('height: calc(100dvh - 2 * var(--dashboard-shell-inset))')
  expect(css).toContain('@media (prefers-reduced-motion: reduce)')
})

test('desktop navigation transitions existing rail and menu instead of duplicating trees', () => {
  const sidebar = read('components/Sidebar.js')
  expect(sidebar).toContain('isHidden={slidingSidebarOpen}')
  expect(sidebar).toContain('setIsCollapsed(!slidingSidebarOpen)')
  expect(sidebar.match(/<IconStrip\b/g)).toHaveLength(1)
  expect(sidebar.match(/<SlidingSidebar\b/g)).toHaveLength(1)
  const rail = read('components/sidebar/IconStrip.js')
  const expanded = read('components/sidebar/SlidingSidebar.js')
  expect(rail).toContain('data-open={!isHidden}')
  expect(rail).toContain('inert={isHidden || undefined}')
  expect(expanded).toContain('data-open={isOpen}')
  expect(expanded).toContain('inert={!isOpen || undefined}')
  expect(expanded).not.toContain('fixed inset-y-0 left-0')
})

test('keyboard dismissal and focus return remain available during state swaps', () => {
  const expanded = read('components/sidebar/SlidingSidebar.js')
  expect(expanded).toContain("event.key === 'Escape'")
  expect(expanded).toContain("document.querySelector('[data-sidebar-expand]')")
  expect(expanded).toContain('target?.focus({ preventScroll: true })')
  expect(expanded).toContain('cancelAnimationFrame(frame)')
})

test('closed mobile navigation cannot intercept clicks or keyboard focus', () => {
  const sidebar = read('components/Sidebar.js')
  const css = read('app/dashboard/dashboard-layout.css')
  expect(sidebar).toContain('talio-floating-mobile-sidebar')
  expect(sidebar).toContain('inert={!isOpen || undefined}')
  expect(css).toContain('width: min(288px, calc(100vw - 2 * var(--dashboard-shell-inset)))')
  expect(css).toContain('.talio-floating-mobile-sidebar[data-open="false"] { opacity: 0; visibility: hidden; pointer-events: none; }')
})
