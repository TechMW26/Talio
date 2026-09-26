import { act, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useAuthedSWR, { useAuthedSWRStatic } from '@/hooks/useAuthedSWR'

const response = data => ({ ok: true, status: 200, json: async () => data })
beforeEach(() => { global.fetch = jest.fn(); localStorage.setItem('token', 'test') })
afterEach(() => { delete global.fetch; localStorage.clear() })

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
