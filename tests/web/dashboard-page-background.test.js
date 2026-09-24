import fs from 'fs'
import path from 'path'
const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

test.each([
  'app/dashboard/team/regularisation/page.js',
  'app/dashboard/performance/goals/page.js',
  'app/dashboard/performance/goals/[id]/page.js',
  'app/dashboard/chat/page.js',
  'app/dashboard/meetings/room/[roomId]/page.js',
  'app/dashboard/layout.js',
  'components/ui/DashboardRouteTransition.js',
])('page canvas uses the shared theme background: %s', file => {
  expect(read(file)).toContain('dashboard-page-canvas')
})

test('dark canvas overrides legacy grey utilities without changing nested surfaces or light mode', () => {
  const css = read('app/globals.css')
  expect(css).toMatch(/html\.dark body \.dashboard-page-canvas\s*\{\s*background: var\(--color-bg-main, #090909\) !important;/)
  expect(css).not.toContain('.dashboard-page-canvas *')
  const page = read('app/dashboard/team/regularisation/page.js')
  expect(page).toContain('border-default-100 bg-default-50')
})

test('goal loading, error and loaded page states all use the same background', () => {
  for (const file of ['app/dashboard/performance/goals/page.js', 'app/dashboard/performance/goals/[id]/page.js']) {
    const roots = [...read(file).matchAll(/className="([^"]*min-h-screen[^"]*)"/g)]
    expect(roots.length).toBeGreaterThan(0)
    for (const [, classes] of roots) expect(classes).toContain('dashboard-page-canvas')
  }
})
