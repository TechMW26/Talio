import { act, render } from '@testing-library/react'
import RemoteSupportOverlay from '@/components/remoteSupport/RemoteSupportOverlay'

jest.mock('@/utils/userHelper', () => ({ getToken: () => 'local-test-token' }))
jest.mock('@/components/remoteSupport/RemoteSupportSessionView', () => () => null)

const IDLE_MS = 30000
const ACTIVE_MS = 3500

beforeEach(() => { jest.useFakeTimers(); global.fetch = jest.fn() })
afterEach(() => { jest.useRealTimers(); delete global.fetch })

test('idle polls back off, never overlap, and unmount aborts the active request', async () => {
  let finish
  fetch.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = render(<RemoteSupportOverlay />)
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => { jest.advanceTimersByTime(15000) })
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => { finish({ ok: true, json: async () => ({ success: true, sessions: [] }) }) })
  // No pending session → the idle back-off applies instead of the fast cadence.
  await act(async () => { jest.advanceTimersByTime(ACTIVE_MS) })
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => { jest.advanceTimersByTime(IDLE_MS) })
  expect(fetch).toHaveBeenCalledTimes(2)
  const signal = fetch.mock.calls[1][1].signal
  view.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => { jest.advanceTimersByTime(120000) })
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
  await act(async () => { jest.advanceTimersByTime(IDLE_MS) })
  expect(fetch).toHaveBeenCalledTimes(2)
  view.unmount()
})

test('a pending request keeps the fast poll cadence', async () => {
  fetch.mockImplementation(() => Promise.resolve({
    ok: true,
    json: async () => ({ success: true, sessions: [{ id: 's1', side: 'employee', status: 'pending' }] }),
  }))
  const view = render(<RemoteSupportOverlay />)
  await act(async () => {})
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => { jest.advanceTimersByTime(ACTIVE_MS) })
  expect(fetch).toHaveBeenCalledTimes(2)
  view.unmount()
})

test('a hidden tab skips polling entirely', async () => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
  try {
    const view = render(<RemoteSupportOverlay />)
    await act(async () => { jest.advanceTimersByTime(120000) })
    expect(fetch).not.toHaveBeenCalled()
    view.unmount()
  } finally {
    delete document.hidden
  }
})
