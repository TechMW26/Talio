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

test('both desktop sidebar states share taller left-aligned geometry with space for native mac controls', () => {
  const css = read('app/dashboard/dashboard-layout.css')
  expect(css).toContain('--dashboard-navigation-inset: 6px')
  expect(css).toContain('--dashboard-rail-width: 88px')
  expect(css).toContain('--dashboard-expanded-width: 19rem')
  expect(css).toContain('.talio-floating-rail, .talio-floating-expanded {')
  expect(css).toContain('height: calc(100dvh - 2 * var(--dashboard-navigation-inset))')
  expect(css).toContain('width: calc(var(--dashboard-rail-width) + var(--dashboard-navigation-inset) - var(--dashboard-shell-inset))')
  expect(read('components/Sidebar.js')).toContain('talio-sidebar-spacer hidden lg:block flex-shrink-0')
  expect(read('components/sidebar/IconStrip.js')).not.toContain('w-[4.5rem]')
  expect(read('components/sidebar/SlidingSidebar.js')).not.toContain('w-[18rem]')
  // The existing native app clearance keeps the logo and expand control below the lights.
  expect(read('desktop-app/src/main.js')).toContain('padding-top: 38px !important')
})

test('navigation sits above the header and its dismissal backdrop covers header actions', () => {
  const css = read('app/dashboard/dashboard-layout.css')
  expect(css).toContain('z-index: 80')
  expect(read('components/sidebar/IconStrip.js')).toContain('fixed z-[100]')
  expect(read('components/sidebar/SlidingSidebar.js')).toContain('fixed z-[120]')
  expect(read('components/sidebar/SlidingSidebar.js')).toContain('fixed inset-0 z-[110]')
  expect(read('components/Sidebar.js')).toContain('fixed z-[120]')
  expect(read('components/Sidebar.js')).toContain('fixed inset-0 z-[110]')
})

test('equal sidebar insets and the no-scroll page bottom share the shell baseline', () => {
  const css = read('app/dashboard/dashboard-layout.css')
  expect(css).toMatch(/\.talio-floating-rail, \.talio-floating-expanded \{\s*top: var\(--dashboard-navigation-inset\);\s*bottom: var\(--dashboard-navigation-inset\);/)
  expect(css).toContain('padding: var(--dashboard-navigation-inset) var(--dashboard-shell-inset)')
  expect(css).toContain('.dashboard-content-frame:has([data-page-sizing="viewport"]):has([data-dashboard-home]) { padding-bottom: 0; }')
  expect(css).toContain('--dashboard-navigation-inset: 8px')
})
