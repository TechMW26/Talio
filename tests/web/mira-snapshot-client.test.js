import { resolveMiraSnapshot } from '@/lib/miraSnapshotClient'
const snapshot = { target: 'Tasks', page: '/', controls: [{ id: '0', label: 'Tasks' }] }
beforeEach(() => {
  window.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, controlId: '0' }) }))
})
afterEach(() => { delete window.electronAPI })
test('older clients resolve a DOM snapshot without requiring desktop capture', async () => {
  expect(await resolveMiraSnapshot(snapshot, { token: 'test' })).toBe('0')
  const body = JSON.parse(fetch.mock.calls[0][1].body)
  expect(body.controls).toEqual(snapshot.controls)
  expect(body.image).toBeUndefined()
})
test('passes the current app screenshot to authenticated vision resolution', async () => {
  window.electronAPI = { captureMiraAppSnapshot: jest.fn(async () => ({ page: '/', image: 'aW1hZ2U=' })) }
  expect(await resolveMiraSnapshot(snapshot, { token: 'test' })).toBe('0')
  expect(JSON.parse(fetch.mock.calls[0][1].body).image).toBe('aW1hZ2U=')
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test')
})
test('does not submit cancelled requests or snapshots for another page', async () => {
  const signal = new AbortController(); signal.abort()
  expect(await resolveMiraSnapshot(snapshot, { token: 'test', signal: signal.signal })).toBeNull()
  expect(await resolveMiraSnapshot({ ...snapshot, page: '/other' }, { token: 'test' })).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})
