import { act, renderHook } from '@testing-library/react'
import useMiraProactive from '@/hooks/useMiraProactive'

const mockMutate = jest.fn().mockResolvedValue(), mockSWR = jest.fn()
jest.mock('swr', () => ({ __esModule: true, mutate: jest.fn(), default: (...args) => { mockSWR(...args); return { mutate: mockMutate } } }))

beforeEach(() => {
  jest.clearAllMocks()
  localStorage.clear()
  localStorage.setItem('token', 'account-one-token')
})

test('keeps hidden native PiP current only while Mira is open and partitions the cache by account', () => {
  const view = renderHook(props => useMiraProactive(props), { initialProps: { enabled: true, accountKey: 'tenant-one:user-one', backgroundActive: true } })
  expect(mockSWR.mock.calls.at(-1)[0]).toEqual(['mira-attention', 'tenant-one:user-one'])
  expect(mockSWR.mock.calls.at(-1)[2]).toMatchObject({ refreshWhenHidden: true, refreshWhenOffline: false, refreshInterval: 30000, keepPreviousData: false })
  view.rerender({ enabled: true, accountKey: 'tenant-two:user-two', backgroundActive: false })
  expect(mockSWR.mock.calls.at(-1)[0]).toEqual(['mira-attention', 'tenant-two:user-two'])
  expect(mockSWR.mock.calls.at(-1)[2].refreshWhenHidden).toBe(false)
})

test('scoped realtime notification hints refresh immediately, unrelated changes and unmounted hooks do not', () => {
  const view = renderHook(() => useMiraProactive({ enabled: true, accountKey: 'tenant-one:user-one' }))
  act(() => window.dispatchEvent(new CustomEvent('talio:data-change', { detail: { source: 'realtime:task-updated' } })))
  expect(mockMutate).not.toHaveBeenCalled()
  act(() => window.dispatchEvent(new CustomEvent('talio:data-change', { detail: { source: 'realtime:new-notification' } })))
  expect(mockMutate).toHaveBeenCalledTimes(1)
  view.unmount()
  act(() => window.dispatchEvent(new CustomEvent('talio:data-change', { detail: { source: 'realtime:new-notification' } })))
  expect(mockMutate).toHaveBeenCalledTimes(1)
})

test('a signed-out or disabled hook neither subscribes nor exposes an SWR cache key', () => {
  renderHook(() => useMiraProactive({ enabled: false, accountKey: '' }))
  expect(mockSWR.mock.calls.at(-1)[0]).toBeNull()
  act(() => window.dispatchEvent(new CustomEvent('mira:reminder-created')))
  act(() => window.dispatchEvent(new CustomEvent('talio:data-change', { detail: { source: 'realtime:new-notification' } })))
  expect(mockMutate).not.toHaveBeenCalled()
})

test('fetch responses from a superseded account are rejected before reaching the cache', async () => {
  renderHook(() => useMiraProactive({ enabled: true, accountKey: 'tenant-one:user-one' }))
  let complete
  global.fetch = jest.fn(() => new Promise(resolve => { complete = resolve }))
  const response = mockSWR.mock.calls.at(-1)[1]()
  localStorage.setItem('token', 'account-two-token')
  complete({ ok: true, json: async () => ({ success: true, data: { events: [{ title: 'Account one secret' }] } }) })
  await expect(response).rejects.toThrow('Account changed.')
})
