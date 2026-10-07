import fs from 'fs'
import path from 'path'
import { SYSTEM_ROLE_DEFINITIONS } from '@/lib/systemRoles'
const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

test.each([
  'app/dashboard/team/regularisation/page.js',
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

test('retired goals and ratings routes, including goal subpages, are removed', () => {
  for (const route of ['goals', 'goals/create', 'goals/[id]', 'goals/edit/[id]', 'ratings']) {
    expect(fs.existsSync(path.join(process.cwd(), 'app/dashboard/performance', route, 'page.js'))).toBe(false)
  }
})

test('retired pages have no active navigation, search, widget or permission entry points', () => {
  for (const file of [
    'utils/roleBasedMenus.js', 'components/Sidebar.js', 'components/sidebar/IconStrip.js',
    'components/sidebar/SlidingSidebar.js', 'components/RoleBasedAccess.js',
    'app/api/search/route.js', 'components/widgets/GoalsWidget.js',
    'app/dashboard/performance/page.js', 'app/dashboard/performance/my-performance/page.js',
    'lib/permissions.shared.js', 'lib/miraAppMap.generated.json', 'lib/miraAppRoutes.generated.json',
  ]) {
    expect(read(file)).not.toMatch(/\/dashboard\/performance\/(goals|ratings)/)
  }
  expect(read('lib/systemRoles.js')).not.toMatch(/S\.PERFORMANCE_(GOALS|RATINGS)/)
})

test('built-in roles no longer grant retired page permissions or undefined slugs', () => {
  for (const role of Object.values(SYSTEM_ROLE_DEFINITIONS)) {
    const permissions = role.buildPermissions()
    for (const slug of ['undefined', 'performance_goals', 'performance_goals_create', 'performance_ratings']) {
      expect(permissions).not.toHaveProperty(slug)
    }
  }
})
