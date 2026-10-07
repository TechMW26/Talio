import fs from 'node:fs'
import path from 'node:path'

const read = file => fs.readFileSync(file, 'utf8')

test('self-explanatory widgets keep accessible names without introductory banners', () => {
  const team = read('components/widgets/TeamAttendanceWidget.js')
  expect(team).toContain('aria-label="Team attendance"')
  expect(team).toContain('aria-label="View all team attendance"')
  expect(team).not.toContain('<h3>Team Attendance</h3>')
  expect(team).not.toContain('Recent Team Status')
  expect(team).toContain('aria-label="Team attendance records"')
  const punches = read('components/widgets/CheckInOutWidget.js')
  expect(punches).not.toContain('Make today count.')
  for (const label of ['Check In', 'Check Out', 'Time worked', 'Work schedule']) {
    expect(punches).toContain(`<h3>${label}</h3>`)
  }
  const glance = read('components/widgets/QuickGlanceWidget.js')
  expect(glance).toContain('aria-label="Quick Glance"')
  expect(glance).not.toContain('<h3>Quick Glance</h3>')
})

test('repeated table titles are removed, while modal and distinct section titles remain', () => {
  for (const [file, title] of [
    ['expenses', 'My Expenses'], ['users', 'All Users'], ['designations', 'All Designations'],
    ['performance', 'Performance Reviews'], ['documents', 'My documents'],
  ]) {
    expect(read(`app/dashboard/${file}/page.js`)).not.toMatch(new RegExp(`<Heading[23][^>]*>${title}</Heading[23]>`))
  }
  expect(read('app/dashboard/expenses/page.js')).toContain('>Submit Expense</Heading2>')
  expect(read('app/dashboard/leave/balance/page.js')).toContain('>Monthly Leave Usage</Heading3>')
  expect(read('components/settings/MiraSettings.js')).toContain('>Personal instructions</h3>')
})

test('every dashboard route remains present and the audit does not hide headings globally', () => {
  const routes = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.name === 'page.js') routes.push(file)
    }
  }
  walk('app/dashboard')
  expect(routes).toHaveLength(90)
  for (const file of routes) expect(read(file)).toContain('export default')
  expect(read('components/ui/fernly/native.js')).not.toContain('sr-only')
})
