const fs = require('fs')
const path = require('path')

test('list widgets have a bounded viewport to trigger internal overflow', () => {
  const css = fs.readFileSync('app/globals.css', 'utf8')
  expect(css).toContain('height: 320px; min-height: 320px; max-height: 320px; overflow: hidden;')
  expect(css).toContain('height: 400px; min-height: 400px; max-height: 400px;')
  expect(fs.readFileSync('components/widgets/CheckInOutWidget.module.css', 'utf8')).toContain('.punches { padding-left: 16px; }')
})

test('all scroll-shadow widget lists fill available height instead of using old caps', () => {
  const files = fs.readdirSync('components/widgets').filter(file => file.endsWith('Widget.js')).map(file => path.join('components/widgets', file))
  files.push('components/dashboards/ProjectTasksWidget.js')
  let count = 0
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const [tag] of source.matchAll(/<ScrollShadow\b[^>]*>/g)) {
      count++
      expect(tag).toContain('data-widget-list')
      expect(tag).toContain('flex-1 min-h-0')
      expect(tag).not.toMatch(/max-h-/)
    }
  }
  expect(count).toBe(15)
})

test('nested list wrappers can shrink and project tasks fills its parent', () => {
  for (const name of ['RoleNewsWidget', 'LeaveBalanceWidget', 'AnnouncementsWidget']) {
    const source = fs.readFileSync(`components/widgets/${name}.js`, 'utf8')
    expect(source).toContain('flex-1 min-h-0 flex flex-col')
  }
  expect(fs.readFileSync('components/dashboards/ProjectTasksWidget.js', 'utf8')).toContain('flex min-h-0 flex-1 flex-col h-full')
  expect(fs.readFileSync('components/dashboard/CustomizableDashboard.js', 'utf8')).toContain('data-scrollable-widget={scrollableList || undefined}')
})
