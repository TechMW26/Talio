/** @jest-environment node */

const fs = require('fs')
const path = require('path')

describe('dashboard performance boundaries', () => {
  const layoutSource = fs.readFileSync(path.join(process.cwd(), 'app/dashboard/layout.js'), 'utf8')
  const transitionCss = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
  const transitionContext = fs.readFileSync(path.join(process.cwd(), 'contexts/PageTransitionContext.js'), 'utf8')
  const serverSource = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8')
  const draggableWidgetSource = fs.readFileSync(path.join(process.cwd(), 'components/dashboard/DraggableWidget.js'), 'utf8')

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
})
