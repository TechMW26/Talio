import { dashboardRequest } from '@/lib/client/dashboardRequest'
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })
test('retries an interrupted GET once and retains auth and freshness', async () => {
  global.fetch = jest.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
  await expect(dashboardRequest('/api/dashboard/hr-stats', 'test-token')).resolves.toEqual({ success: true })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[1][1]).toMatchObject({ cache: 'no-store', headers: { Authorization: 'Bearer test-token' } })
})
test('does not retry denied access', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 })
  await expect(dashboardRequest('/api/dashboard/hr-stats', 'test')).rejects.toMatchObject({ status: 403 })
  expect(fetch).toHaveBeenCalledTimes(1)
})
test('bounds stalled reads, including body consumption', async () => {
  jest.useFakeTimers()
  global.fetch = jest.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
  const request = dashboardRequest('/api/dashboard/unified', 'test', { timeoutMs: 50 })
  const assertion = expect(request).rejects.toThrow('too long')
  await jest.advanceTimersByTimeAsync(51)
  await assertion
  expect(fetch).toHaveBeenCalledTimes(1)
})
