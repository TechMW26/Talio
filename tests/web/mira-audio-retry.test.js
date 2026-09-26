import { fetchMiraAudio } from '@/lib/miraSpeechPlayback'

beforeEach(() => { jest.useFakeTimers(); global.fetch = jest.fn() })
afterEach(() => { jest.useRealTimers(); delete global.fetch })
test('transient audio failures retry without invoking any chat action', async () => {
  const ok = { ok: true }
  fetch.mockResolvedValueOnce({ ok: false, status: 503 }).mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(ok)
  const pending = fetchMiraAudio({ signal: new AbortController().signal })
  await jest.runAllTimersAsync()
  expect(await pending).toBe(ok)
  expect(fetch).toHaveBeenCalledTimes(3)
})
test('authentication failures do not retry', async () => {
  fetch.mockResolvedValue({ ok: false, status: 401 })
  await expect(fetchMiraAudio({ signal: new AbortController().signal })).rejects.toThrow('unavailable')
  expect(fetch).toHaveBeenCalledTimes(1)
})
test('cancellation during backoff prevents retries', async () => {
  fetch.mockResolvedValue({ ok: false, status: 429 })
  const controller = new AbortController()
  const pending = fetchMiraAudio({ signal: controller.signal })
  const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await jest.advanceTimersByTimeAsync(1)
  controller.abort()
  await assertion
  expect(fetch).toHaveBeenCalledTimes(1)
})
