import { act, render, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useAuthedSWR, { useAuthedSWRStatic, useAuthedSWRRealtime } from '@/hooks/useAuthedSWR'

const response = data => ({ ok: true, status: 200, json: async () => data })
beforeEach(() => { global.fetch = jest.fn(); localStorage.setItem('token', 'test') })
afterEach(() => { delete global.fetch; localStorage.clear() })

test.each([useAuthedSWR, useAuthedSWRStatic])('repeat mounts share a recent read but explicit refresh is immediate', async useHook => {
  fetch.mockResolvedValue(response({ count: 1 }))
  const cache = new Map()
  const config = { provider: () => cache }
  let current
  function Reader() { current = useHook('/api/cost-test'); return <div>{current.data?.count}</div> }
  function Harness({ show }) { return <SWRConfig value={config}>{show && <Reader />}</SWRConfig> }
  const page = render(<Harness show />)
  await waitFor(() => expect(current.data?.count).toBe(1))
  page.rerender(<Harness show={false} />)
  page.rerender(<Harness show />)
  expect(current.data.count).toBe(1)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
  expect(fetch).toHaveBeenCalledTimes(1)
  fetch.mockResolvedValue(response({ count: 2 }))
  await act(async () => { await current.mutate() })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(current.data.count).toBe(2)
})

test('timeout remains active while the response body is stalled', async () => {
  jest.useFakeTimers()
  try {
    fetch.mockImplementation(async (_, { signal }) => ({ ok: true, status: 200,
      json: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    }))
    const wrapper = ({ children }) => <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
    const { result, unmount } = renderHook(() => ({ error: useAuthedSWR('/api/stalled-body').error }), { wrapper })
    await act(async () => { await Promise.resolve() })
    await act(async () => { jest.advanceTimersByTime(15001) })
    expect(result.current.error.message).toContain('timed out')
    expect(fetch).toHaveBeenCalledTimes(1)
    unmount()
  } finally { jest.useRealTimers() }
})

test('realtime permanent client errors do not schedule retries', async () => {
  fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) })
  const onErrorRetry = jest.fn()
  const wrapper = ({ children }) => <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
  const { result } = renderHook(() => useAuthedSWRRealtime('/api/forbidden', { onErrorRetry }), { wrapper })
  await waitFor(() => expect(result.current.error?.status).toBe(403))
  expect(onErrorRetry).not.toHaveBeenCalled()
})

test('page switches retain visible data while fetching and show updated values when ready', async () => {
  let finish
  fetch.mockResolvedValueOnce(response({ count: 1 })).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const cache = new Map()
  const wrapper = ({ children }) => <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
  const { result, rerender } = renderHook(({ url }) => useAuthedSWR(url), { initialProps: { url: '/api/assets?page=1' }, wrapper })
  await waitFor(() => expect(result.current.data?.count).toBe(1))
  rerender({ url: '/api/assets?page=2' })
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(result.current.isLoading).toBe(false)
  expect(result.current.isValidating).toBe(true)
  expect(result.current.data.count).toBe(1)
  await act(async () => finish(response({ count: 2 })))
  await waitFor(() => expect(result.current.data.count).toBe(2))
})

test('static data remounts show the cache immediately and refresh it in the background', async () => {
  fetch.mockResolvedValue(response({ name: 'Original' }))
  const cache = new Map()
  const wrapper = ({ children }) => <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
  const first = renderHook(() => useAuthedSWRStatic('/api/departments', { dedupingInterval: 0 }), { wrapper })
  await waitFor(() => expect(first.result.current.data?.name).toBe('Original'))
  first.unmount()
  let finish
  fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const next = renderHook(() => useAuthedSWRStatic('/api/departments', { dedupingInterval: 0 }), { wrapper })
  expect(next.result.current.data.name).toBe('Original')
  expect(next.result.current.isLoading).toBe(false)
  await waitFor(() => expect(finish).toBeDefined())
  await act(async () => finish(response({ name: 'Changed' })))
  await waitFor(() => expect(next.result.current.data.name).toBe('Changed'))
})

test('unchanged responses retain the cached data reference while mutations refresh immediately', async () => {
  fetch.mockImplementation(async () => response({ items: [{ id: 'one', name: 'Original' }] }))
  const cache = new Map()
  const wrapper = ({ children }) => <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
  const { result } = renderHook(() => useAuthedSWR('/api/assets'), { wrapper })
  await waitFor(() => expect(result.current.data?.items).toHaveLength(1))
  const original = result.current.data
  await act(async () => { await result.current.mutate() })
  expect(result.current.data).toBe(original)
  fetch.mockResolvedValueOnce(response({ items: [{ id: 'one', name: 'Changed' }] }))
  await act(async () => { await result.current.mutate() })
  expect(result.current.data.items[0].name).toBe('Changed')
})

test('data-only consumers do not rerender for unchanged background validation', async () => {
  fetch.mockResolvedValue(response({ count: 1 }))
  const cache = new Map()
  const wrapper = ({ children }) => <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
  let renders = 0
  const { result } = renderHook(() => {
    renders++
    const { data, mutate } = useAuthedSWR('/api/test-stable')
    return { data, mutate }
  }, { wrapper })
  await waitFor(() => expect(result.current.data?.count).toBe(1))
  const before = renders
  await act(async () => { await result.current.mutate() })
  expect(renders).toBe(before)
})
