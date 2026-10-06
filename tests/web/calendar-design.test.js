import fs from 'node:fs'
import path from 'node:path'
const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
test.each([
  'app/dashboard/calendar/page.js',
  'app/dashboard/attendance/page.js',
  'app/dashboard/attendance/team/page.js',
  'app/dashboard/holidays/page.js',
  'app/dashboard/team/members/[id]/MemberAttendance.js',
])('%s uses shared calendar geometry', file => {
  const source = read(file)
  expect(source).toContain('@/components/ui/fernly/calendar.module.css')
  expect(source).toContain('calendar.grid')
  expect(source).not.toContain('min-w-[700px]')
})
test('calendar tiles override pill buttons without changing business status colours', () => {
  const css = read('components/ui/fernly/calendar.module.css')
  expect(css).toContain('repeat(7, minmax(0, 1fr))')
  expect(css).toContain('border-radius: 14px !important')
  expect(css).toContain('padding: 10px !important')
  expect(css).toContain(':focus-visible')
  expect(css).toContain('@media (max-width: 640px)')
  expect(css).not.toContain('data-status')
})
