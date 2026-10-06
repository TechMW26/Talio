import { directoryInternals, listDirectory } from '@/lib/services/directoryService.server'
jest.mock('@/lib/cache', () => ({ buildCacheKey: jest.fn(args => JSON.stringify(args)), getCache: jest.fn().mockResolvedValue(null), setCache: jest.fn().mockResolvedValue(undefined) }))

describe('directory service query hardening', () => {
  test('escapes regular expression metacharacters', () => {
    expect(directoryInternals.escapeRegex('a.*(b)[c]$')).toBe('a\\.\\*\\(b\\)\\[c\\]\\$')
  })

  test.each([
    [undefined, 50],
    ['0', 1],
    ['-20', 1],
    ['25', 25],
    ['1000', 100],
    ['invalid', 50],
  ])('clamps directory limit %p to %p', (input, expected) => {
    expect(directoryInternals.clampLimit(input)).toBe(expected)
  })
})

test('directory pages remain tenant-scoped and include probation/on-leave employees', async () => {
  const database = {
    databaseName: 'tenant-a',
    get: jest.fn(async () => ({ employeeId: 'self' })),
    getMany: jest.fn(async () => []),
    list: jest.fn(async (collection, options) => collection === 'employees'
      ? { records: options.cursor ? [{ _id: 'employee-101', firstName: 'Last', status: 'probation' }] : Array.from({ length: 100 }, (_, index) => ({ _id: `employee-${index}`, firstName: `Name${index}`, status: 'active' })), nextCursor: options.cursor ? null : 'next-page' }
      : { records: [] }),
  }
  const rows = await listDirectory({ database, tenantId: 'tenant-a', currentUserId: 'user-a', page: 2, limit: 100 })
  expect(database.list).toHaveBeenCalledWith('employees', expect.objectContaining({ filters: [{ field: 'status', operator: 'in', value: ['active', 'probation', 'on_leave'] }], cursor: 'next-page' }))
  expect(rows[0]._id).toBe('employee-101')
  const { buildCacheKey } = require('@/lib/cache')
  expect(buildCacheKey).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', userId: 'user-a', params: expect.objectContaining({ safePage: 2 }) }))
})
