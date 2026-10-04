import { act, render } from '@testing-library/react'
import RemoteSupportOverlay from '@/components/remoteSupport/RemoteSupportOverlay'

jest.mock('@/utils/userHelper', () => ({ getToken: () => 'local-test-token' }))
jest.mock('@/components/remoteSupport/RemoteSupportSessionView', () => () => null)

beforeEach(() => { jest.useFakeTimers(); global.fetch = jest.fn() })
afterEach(() => { jest.useRealTimers(); delete global.fetch })

test('slow polls never overlap, and unmount aborts the active request', async () => {
  let finish
  fetch.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = render(<RemoteSupportOverlay />)
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => { jest.advanceTimersByTime(15000) })
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => { finish({ ok: true, json: async () => ({ success: true, sessions: [] }) }) })
  await act(async () => { jest.advanceTimersByTime(3500) })
  expect(fetch).toHaveBeenCalledTimes(2)
  const signal = fetch.mock.calls[1][1].signal
  view.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => { jest.advanceTimersByTime(30000) })
  expect(fetch).toHaveBeenCalledTimes(2)
})

test('a stalled request is aborted before scheduling its replacement', async () => {
  fetch.mockImplementation((_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  const view = render(<RemoteSupportOverlay />)
  await act(async () => { jest.advanceTimersByTime(20000) })
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => { jest.advanceTimersByTime(3500) })
  expect(fetch).toHaveBeenCalledTimes(2)
  view.unmount()
})
