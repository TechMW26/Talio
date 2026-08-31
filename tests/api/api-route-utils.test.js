import { getPagination } from '@/lib/api/query'

describe('tenant API utilities', () => {
  test('normalizes pagination and calculates a stable skip', () => {
    const params = new URLSearchParams({ page: '3', limit: '25' })
    expect(getPagination(params)).toEqual({ page: 3, limit: 25, skip: 50 })
  })

  test('clamps unsafe pagination inputs', () => {
    expect(getPagination(new URLSearchParams({ page: '-2', limit: '9999' })))
      .toEqual({ page: 1, limit: 100, skip: 0 })
  })
})
