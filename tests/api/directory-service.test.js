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
  const chain = { select: jest.fn().mockReturnThis(), populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ _id: 'employee-101', firstName: 'Last', status: 'probation' }]) }
  const Employee = { find: jest.fn(() => chain) }
  const User = {
    findById: jest.fn(() => ({ select: () => ({ lean: async () => ({ employeeId: 'self' }) }) })),
    find: jest.fn(() => ({ select: () => ({ lean: async () => [] }) })),
  }
  const rows = await listDirectory({ Employee, User, tenantId: 'tenant-a', currentUserId: 'user-a', page: 2, limit: 100 })
  expect(Employee.find).toHaveBeenCalledWith({ status: { $in: ['active', 'probation', 'on_leave'] }, _id: { $ne: 'self' } })
  expect(chain.skip).toHaveBeenCalledWith(100)
  expect(rows[0]._id).toBe('employee-101')
  const { buildCacheKey } = require('@/lib/cache')
  expect(buildCacheKey).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', userId: 'user-a', params: expect.objectContaining({ safePage: 2 }) }))
})
