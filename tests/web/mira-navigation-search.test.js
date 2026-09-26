import { searchMiraNavigation } from '@/lib/miraNavigationSearch'

test('uses authenticated header search and only returns known internal pages', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { pages: [
    { title: 'Team Attendance', link: '/dashboard/attendance/team' },
    { title: 'Duplicate', link: '/dashboard/attendance/team' },
    { title: 'External', link: 'https://evil.test/dashboard' },
    { title: 'Unknown', link: '/dashboard/invented' },
  ] } }) })
  const signal = new AbortController().signal
  await expect(searchMiraNavigation('Team Attendance', { token: 'test', signal })).resolves.toEqual([{ title: 'Team Attendance', path: '/dashboard/attendance/team' }])
  expect(fetch).toHaveBeenCalledWith('/api/search?q=Team%20Attendance', { headers: { Authorization: 'Bearer test' }, signal })
})

test('handles malformed results, expired authentication and opaque control IDs', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { pages: {} } }) })
  await expect(searchMiraNavigation('Attendance')).resolves.toEqual([])
  fetch.mockResolvedValue({ ok: false })
  await expect(searchMiraNavigation('Attendance')).rejects.toThrow('unavailable')
  fetch.mockClear()
  await expect(searchMiraNavigation('ui-99')).resolves.toEqual([])
  expect(fetch).not.toHaveBeenCalled()
})
