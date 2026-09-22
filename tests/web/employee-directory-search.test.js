import { act, renderHook } from '@testing-library/react'
import useEmployeeDirectorySearch from '@/hooks/useEmployeeDirectorySearch'
import useAuthedSWR from '@/hooks/useAuthedSWR'

jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn(() => ({ data: { data: [] } })) }))

test('loads complete lists and issues new debounced server queries on search', () => {
  jest.useFakeTimers()
  const { rerender, unmount } = renderHook(({ query }) => useEmployeeDirectorySearch({ query }), { initialProps: { query: '' } })
  expect(useAuthedSWR.mock.calls.at(-1)[0]).toContain('all=true')
  rerender({ query: 'Tech Team' })
  act(() => jest.advanceTimersByTime(250))
  const url = useAuthedSWR.mock.calls.at(-1)[0]
  expect(url).toContain('q=Tech+Team')
  expect(url).toContain('all=true')
  rerender({ query: '' })
  act(() => jest.advanceTimersByTime(250))
  expect(useAuthedSWR.mock.calls.at(-1)[0]).not.toContain('q=')
  unmount()
  jest.useRealTimers()
})
