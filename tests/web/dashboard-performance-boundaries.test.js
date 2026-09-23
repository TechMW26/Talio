/** @jest-environment node */

const fs = require('fs')
const path = require('path')

describe('dashboard performance boundaries', () => {
  test('punch cards have equal top, bottom and right outer spacing', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'components/widgets/CheckInOutWidget.module.css'), 'utf8')
    const punches = css.match(/\.punches\s*\{([^}]+)\}/)[1]
    expect(punches).toContain('padding-block: 16px')
    expect(punches).toContain('padding-right: 16px')
    expect(punches).toContain('repeat(2,minmax(0,1fr))')
  })
  const layoutSource = fs.readFileSync(path.join(process.cwd(), 'app/dashboard/layout.js'), 'utf8')
  const transitionCss = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
  const transitionContext = fs.readFileSync(path.join(process.cwd(), 'contexts/PageTransitionContext.js'), 'utf8')
  const packageJson = require('../../package.json')
  const draggableWidgetSource = fs.readFileSync(path.join(process.cwd(), 'components/dashboard/DraggableWidget.js'), 'utf8')
  const customizableDashboardSource = fs.readFileSync(path.join(process.cwd(), 'components/dashboard/CustomizableDashboard.js'), 'utf8')
  const unifiedDashboardSource = fs.readFileSync(path.join(process.cwd(), 'components/dashboards/UnifiedDashboard.js'), 'utf8')
  const validateAuthSource = fs.readFileSync(path.join(process.cwd(), 'app/api/auth/validate/route.js'), 'utf8')
  const loginSource = fs.readFileSync(path.join(process.cwd(), 'app/api/auth/login/route.js'), 'utf8')
  const companyFeaturesSource = fs.readFileSync(path.join(process.cwd(), 'contexts/CompanyFeaturesContext.js'), 'utf8')
  const authedSwrSource = fs.readFileSync(path.join(process.cwd(), 'hooks/useAuthedSWR.js'), 'utf8')
  const authSource = fs.readFileSync(path.join(process.cwd(), 'lib/auth.js'), 'utf8')
  const companyFeatureServerSource = fs.readFileSync(path.join(process.cwd(), 'lib/companyFeatures.server.js'), 'utf8')
  const clientDataSyncSource = fs.readFileSync(path.join(process.cwd(), 'lib/clientDataSync.js'), 'utf8')
  const socketContextSource = fs.readFileSync(path.join(process.cwd(), 'contexts/SocketContext.js'), 'utf8')
  const employeeStatsSource = fs.readFileSync(path.join(process.cwd(), 'app/api/dashboard/employee-stats/route.js'), 'utf8')
  const liveUsersSource = fs.readFileSync(path.join(process.cwd(), 'app/api/admin/live-users/route.js'), 'utf8')
  const managerStatsSource = fs.readFileSync(path.join(process.cwd(), 'app/api/dashboard/manager-stats/route.js'), 'utf8')
  const cacheSource = fs.readFileSync(path.join(process.cwd(), 'lib/cache.js'), 'utf8')

  test('does not bundle route skeletons into the persistent dashboard shell', () => {
    expect(layoutSource).not.toContain("@/components/ui/PageSkeletons")
    expect(layoutSource).toContain("@/components/ui/DashboardRouteTransition")
  })

  test('splits optional global dashboard experiences into independent chunks', () => {
    for (const component of [
      'ChatWidgetContainer',
      'ProfileCompletionModal',
      'WebPushPrompt',
      'DesktopNotificationPrompt',
      'MiraChatSidebar',
      'CelebrationPopup',
    ]) {
      expect(layoutSource).toMatch(new RegExp(`const ${component} = dynamic\\(`))
    }
  })

  test('uses CSS-driven transitions with a reduced-motion path', () => {
    expect(transitionCss).toContain('@keyframes dashboard-route-enter')
    expect(transitionCss).toContain('@keyframes dashboard-route-scan')
    expect(transitionCss).toContain('@media (prefers-reduced-motion: reduce)')
  })

  test('memoizes transition context and ignores modified navigation clicks', () => {
    expect(transitionContext).toContain('const value = useMemo(')
    expect(transitionContext).toContain('e.defaultPrevented')
    expect(transitionContext).toContain('e.metaKey')
    expect(transitionContext).toContain('e.ctrlKey')
  })

  test('uses the same Next.js runtime in development and production', () => {
    expect(packageJson.scripts.dev).toContain('next dev')
    expect(packageJson.scripts.start).toContain('next start')
    expect(packageJson.dependencies['node-schedule']).toBeUndefined()
    expect(packageJson.dependencies['socket.io']).toBeUndefined()
  })

  test('does not schedule React rerenders for widget entrance or hover effects', () => {
    expect(draggableWidgetSource).not.toContain('setTimeout(')
    expect(draggableWidgetSource).not.toContain('onMouseEnter=')
    expect(draggableWidgetSource).not.toContain('onMouseLeave=')
    expect(draggableWidgetSource).not.toContain("transition || 'all")
    expect(draggableWidgetSource).toContain('dashboard-widget-enter')
    expect(draggableWidgetSource).toContain('group-hover:opacity-100')
  })

  test('keeps authentication off the dashboard data fan-out path', () => {
    expect(validateAuthSource).not.toContain('warmDashboardCaches')
    expect(loginSource).not.toContain('warmDashboardCaches')
  })

  test('does not block API responses on remote cache writes', () => {
    expect(authSource).toContain('void setCache(authCacheKey')
    expect(companyFeatureServerSource).toContain('void setCache(cacheKey, response, 300)')
    expect(authSource).not.toContain('await setCache(authCacheKey')
    expect(companyFeatureServerSource).not.toContain('await setCache(cacheKey, response, 300)')
    expect(cacheSource).toContain('waitUntil(remoteWrite)')
    expect(cacheSource).toContain("process.env.VERCEL === '1'")
  })

  test('defers offscreen widget work until it approaches the viewport', () => {
    expect(customizableDashboardSource).toContain('function DeferredWidgetContent')
    expect(customizableDashboardSource).toContain("rootMargin: '600px 0px'")
    expect(customizableDashboardSource).toContain("<DeferredWidgetContent eager={section.id === 'attendance' || isEditMode}")
    expect(customizableDashboardSource).toContain('scrollableList={WIDGET_REGISTRY[widget.id]?.scrollableList === true}')
    expect(customizableDashboardSource).toContain("scrollableList ? 'min-h-[320px] sm:min-h-[400px]' : 'min-h-[280px]'")
  })

  test('coalesces realtime dashboard bursts and in-flight requests', () => {
    expect(unifiedDashboardSource).toContain('dashboardStatsRequestRef.current')
    expect(unifiedDashboardSource).toContain('unifiedWidgetsRequestRef.current')
    expect(unifiedDashboardSource).toContain('scheduleDashboardRefresh()')
    expect(unifiedDashboardSource).toContain('}, 200)')
  })

  test('deduplicates feature refreshes and respects socket-only realtime data', () => {
    expect(companyFeaturesSource).toContain('FEATURE_CACHE_TTL_MS')
    expect(companyFeaturesSource).toContain('inFlightRefreshRef.current')
    expect(authedSwrSource).toContain('options.refreshInterval ?? 0')
    expect(authedSwrSource).toContain('dedupingInterval: 5000')
    expect(clientDataSyncSource).toContain('REVALIDATION_DEBOUNCE_MS = 250')
    expect(clientDataSyncSource).not.toContain('scheduleApiRevalidation(mutate, scopes)')
    expect(socketContextSource).toContain('}, 60000) // Rare fallback only')
  })

  test('keeps editable dashboard views free of interval polling', () => {
    const eventDrivenViews = [
      'app/dashboard/admin/live-users/page.js',
      'app/dashboard/projects/page.js',
      'app/dashboard/projects/approvals/page.js',
      'app/dashboard/projects/my-tasks/page.js',
      'app/dashboard/projects/assigned-tasks/page.js',
      'app/dashboard/projects/[projectId]/page.js',
      'app/dashboard/team/geofencing/page.js',
      'components/employees/EmployeeLifecyclePanel.js',
      'components/widgets/AttendanceSummaryWidget.js',
      'components/widgets/EmployeeDirectoryWidget.js',
      'components/widgets/LeaveBalanceWidget.js',
    ]

    for (const file of eventDrivenViews) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(source).not.toMatch(/refreshInterval:\s*(?!0\b)\d+/)
    }
  })

  test('batches high-frequency dashboard database work', () => {
    expect((employeeStatsSource.match(/Attendance\.find\(/g) || []).length).toBe(1)
    expect(employeeStatsSource).toContain('attendanceWindow')
    expect(employeeStatsSource).toContain('] = await Promise.all([')
    expect(liveUsersSource).toContain('attendanceByEmployeeId')
    expect(liveUsersSource).not.toContain('todayAttendance.find(')
    expect(liveUsersSource).not.toContain('allUsers.filter(')
    expect((managerStatsSource.match(/Attendance\.find\(/g) || []).length).toBe(1)
    expect(managerStatsSource).toContain('todayAttendanceRows')
    expect(managerStatsSource).toContain('attendanceCountByStatus')
  })
})
