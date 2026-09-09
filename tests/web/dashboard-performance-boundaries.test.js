/** @jest-environment node */

const fs = require('fs')
const path = require('path')

describe('dashboard performance boundaries', () => {
  const layoutSource = fs.readFileSync(path.join(process.cwd(), 'app/dashboard/layout.js'), 'utf8')
  const transitionCss = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
  const transitionContext = fs.readFileSync(path.join(process.cwd(), 'contexts/PageTransitionContext.js'), 'utf8')
  const serverSource = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8')
  const draggableWidgetSource = fs.readFileSync(path.join(process.cwd(), 'components/dashboard/DraggableWidget.js'), 'utf8')
  const customizableDashboardSource = fs.readFileSync(path.join(process.cwd(), 'components/dashboard/CustomizableDashboard.js'), 'utf8')
  const unifiedDashboardSource = fs.readFileSync(path.join(process.cwd(), 'components/dashboards/UnifiedDashboard.js'), 'utf8')
  const validateAuthSource = fs.readFileSync(path.join(process.cwd(), 'app/api/auth/validate/route.js'), 'utf8')
  const loginSource = fs.readFileSync(path.join(process.cwd(), 'app/api/auth/login/route.js'), 'utf8')
  const companyFeaturesSource = fs.readFileSync(path.join(process.cwd(), 'contexts/CompanyFeaturesContext.js'), 'utf8')
  const authedSwrSource = fs.readFileSync(path.join(process.cwd(), 'hooks/useAuthedSWR.js'), 'utf8')
  const authSource = fs.readFileSync(path.join(process.cwd(), 'lib/auth.js'), 'utf8')
  const companyFeatureServerSource = fs.readFileSync(path.join(process.cwd(), 'lib/companyFeatures.server.js'), 'utf8')

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

  test('keeps production schedulers out of the default development process', () => {
    expect(serverSource).toContain("process.env.ENABLE_BACKGROUND_JOBS === 'true'")
    expect(serverSource).toContain("!dev && process.env.ENABLE_BACKGROUND_JOBS !== 'false'")
    expect(serverSource).toContain('if (backgroundJobsEnabled)')
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
  })

  test('defers offscreen widget work until it approaches the viewport', () => {
    expect(customizableDashboardSource).toContain('function DeferredWidgetContent')
    expect(customizableDashboardSource).toContain("rootMargin: '600px 0px'")
    expect(customizableDashboardSource).toContain('<DeferredWidgetContent eager={isEditMode}>')
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
    expect(authedSwrSource).toContain('options.refreshInterval ?? 30000')
  })
})
