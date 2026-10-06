import fs from 'node:fs'
import path from 'node:path'
import { canApplyAttendanceSnapshot } from '@/lib/client/attendanceSnapshot'

// Exercise the real callbacks with controlled network completion order.
const source = fs.readFileSync(path.join(process.cwd(), 'components/dashboards/UnifiedDashboard.js'), 'utf8')
function callback(name, scope) {
  const start = source.indexOf(`const ${name} = useCallback(`) + `const ${name} = useCallback(`.length
  const end = source.indexOf('\n    }, [', start)
  return new Function(...Object.keys(scope), `return (${source.slice(start, end)}\n    })`)(...Object.values(scope))
}
function context() {
  return {
    employeeIdStr: 'employee-a', todayAttendance: null,
    attendanceVersionRef: { current: 0 }, attendanceSubmissionRef: { current: false },
    confirmedAttendanceRef: { current: null }, canApplyAttendanceSnapshot,
    setAttendanceLoading: jest.fn(), setTodayAttendance: jest.fn(),
    localStorage: { getItem: () => 'token' }, getTodayDateString: () => '2026-10-05',
    getAttendanceLocation: async () => ({ latitude: 1, longitude: 2 }),
    toast: { success: jest.fn(), error: jest.fn() }, syncDesktopAttendanceCapture: jest.fn(),
    broadcastChannelRef: { current: { postMessage: jest.fn() } },
    fetchTodayAttendance: jest.fn(), fetchUnifiedWidgetData: jest.fn(), fetchDashboardData: jest.fn(),
    fetch: jest.fn(), console: { warn: jest.fn(), error: jest.fn() },
  }
}
test.each(['handleCheckIn', 'handleCheckOut'])('%s applies confirmed state and forces on-demand refresh', async name => {
  const scope = context(), record = { _id: 'attendance', checkIn: '2026-10-05T04:00:00Z' }
  scope.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: record }) })
  scope.broadcastChannelRef.current.postMessage.mockImplementation(() => { throw new Error('closed channel') })
  await callback(name, scope)()
  expect(scope.setTodayAttendance).toHaveBeenLastCalledWith(record)
  expect(scope.fetchTodayAttendance).toHaveBeenCalledTimes(1)
  expect(scope.fetchUnifiedWidgetData).toHaveBeenCalledWith(true)
  expect(scope.fetchDashboardData).toHaveBeenCalledWith(true)
  expect(scope.toast.error).not.toHaveBeenCalled()
  expect(scope.attendanceSubmissionRef.current).toBe(false)
})
test('failed check-in does not start success refreshes', async () => {
  const scope = context()
  scope.fetch.mockResolvedValue({ json: async () => ({ success: false, message: 'Denied' }) })
  await callback('handleCheckIn', scope)()
  expect(scope.fetchTodayAttendance).not.toHaveBeenCalled()
  expect(scope.toast.error).toHaveBeenCalledWith('Denied')
})
test.each([
  ['handleCheckIn', 400, 'Already clocked in today'],
  ['handleCheckOut', 400, 'Already clocked out today'],
  ['handleCheckOut', 400, 'Please clock in first'],
  ['handleCheckIn', 409, 'Concurrent attendance update'],
])('%s reconciles rejected punches with authoritative reads (%s, %s)', async (name, status, message) => {
  const scope = context()
  scope.confirmedAttendanceRef.current = { record: { checkIn: 'stale' }, day: '2026-10-05' }
  scope.fetch.mockResolvedValue({ status, json: async () => ({ success: false, message }) })
  scope.fetchTodayAttendance.mockImplementation(() => expect(scope.attendanceSubmissionRef.current).toBe(false))
  await callback(name, scope)()
  expect(scope.fetchTodayAttendance).toHaveBeenCalledTimes(1)
  expect(scope.fetchUnifiedWidgetData).toHaveBeenCalledWith(true)
  expect(scope.fetchDashboardData).toHaveBeenCalledWith(true)
  expect(scope.confirmedAttendanceRef.current).toBeNull()
  expect(scope.toast.success).not.toHaveBeenCalled()
})
test('a stale attendance GET cannot overwrite a subsequent confirmed punch', async () => {
  const scope = context()
  let finish
  scope.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const pending = callback('fetchTodayAttendance', scope)()
  scope.attendanceVersionRef.current++
  finish({ ok: true, json: async () => ({ success: true, data: [] }) })
  await pending
  expect(scope.setTodayAttendance).not.toHaveBeenCalled()
})
test.each([
  ['handleCheckIn', 'Already clocked in today', { _id: 'a', checkIn: '2026-10-05T04:00:00Z' }],
  ['handleCheckOut', 'Already clocked out today', { _id: 'a', checkIn: '2026-10-05T04:00:00Z', checkOut: '2026-10-05T12:00:00Z' }],
])('%s replaces empty UI state with the saved record after a duplicate error', async (name, message, record) => {
  const scope = context()
  scope.fetch.mockImplementation(async (_, options) => options.method === 'POST'
    ? { status: 400, json: async () => ({ success: false, message }) }
    : { ok: true, json: async () => ({ success: true, data: [record] }) })
  let refresh
  scope.fetchTodayAttendance = () => { refresh = callback('fetchTodayAttendance', scope)(); return refresh }
  await callback(name, scope)()
  await refresh
  expect(scope.setTodayAttendance).toHaveBeenLastCalledWith(record)
  expect(scope.toast.success).not.toHaveBeenCalled()
})
test('a current empty GET clears previous-day attendance and bypasses HTTP caches', async () => {
  const scope = context()
  scope.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [] }) })
  await callback('fetchTodayAttendance', scope)()
  expect(scope.setTodayAttendance).toHaveBeenCalledWith(null)
  expect(scope.fetch.mock.calls[0][1].cache).toBe('no-store')
})
test('initial dashboard load follows feature-gated widget selection changes', () => {
  const effect = source.match(/useEffect\(\(\) => \{\n        if \(!user \|\| !employeeIdStr\) return[\s\S]*?\n    \}, \[user, employeeIdStr, unifiedWidgetSelection\]\)/)
  expect(effect).not.toBeNull()
})
test('confirmed punches reject stale snapshots but permit fresh data and day rollover', () => {
  const fence = { day: '2026-10-05', record: { _id: 'a', checkIn: 'in', checkOut: 'out', updatedAt: '2026-10-05T12:00:00Z' } }
  expect(canApplyAttendanceSnapshot(null, fence, fence.day)).toBe(false)
  expect(canApplyAttendanceSnapshot({ _id: 'a', checkIn: 'in' }, fence, fence.day)).toBe(false)
  expect(canApplyAttendanceSnapshot({ ...fence.record, updatedAt: '2026-10-05T11:00:00Z' }, fence, fence.day)).toBe(false)
  expect(canApplyAttendanceSnapshot(fence.record, fence, fence.day)).toBe(true)
  expect(canApplyAttendanceSnapshot(null, fence, '2026-10-06')).toBe(true)
})
