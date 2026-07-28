import { QueryCache } from '@/lib/queryCache'

describe('QueryCache', () => {
  test('evicts the least-recently-used entry when bounded', () => {
    const cache = new QueryCache({ maxSize: 2 })
    cache.set('a', 1)
    cache.set('b', 2)

    expect(cache.get('a')).toBe(1)
    cache.set('c', 3)

    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBeNull()
    expect(cache.get('c')).toBe(3)
  })

  test('preserves falsey cached values', () => {
    const cache = new QueryCache()
    cache.set('false', false)
    cache.set('zero', 0)

    expect(cache.get('false')).toBe(false)
    expect(cache.get('zero')).toBe(0)
  })

  test('removes expired values', () => {
    jest.useFakeTimers()
    const cache = new QueryCache()
    cache.set('short-lived', 'value', 10)

    jest.advanceTimersByTime(11)

    expect(cache.get('short-lived')).toBeNull()
    expect(cache.size()).toBe(0)
    jest.useRealTimers()
  })
})
