import { GET } from '@/app/api/superadmin/security/events/route'
import { getSuperadminStore, readAdminPage } from '@/lib/platform/firestoreSuperadmin.server'

jest.mock('@/lib/superadminAuth', () => ({ verifySuperAdmin: jest.fn(async () => ({ success: true })) }))
jest.mock('@/lib/platform/firestoreSuperadmin.server', () => ({ getSuperadminStore: jest.fn(), readAdminPage: jest.fn() }))

beforeEach(() => {
  jest.clearAllMocks()
  getSuperadminStore.mockResolvedValue({ count: jest.fn(async () => 0) })
  readAdminPage.mockResolvedValue({ records: [], nextCursor: null })
})

test('rejects membership combinations beyond the Firestore disjunction budget before any read', async () => {
  const response = await GET(new Request('http://localhost/api/superadmin/security/events?type=a,b,c,d,e,f&severity=a,b,c,d,e,f'))
  expect(response.status).toBe(400)
  expect(getSuperadminStore).not.toHaveBeenCalled()
})

test('accepts combinations within the full query budget and deduplicates repeated values', async () => {
  const response = await GET(new Request('http://localhost/api/superadmin/security/events?type=a,b,c,d,a&severity=a,b,c,d'))
  expect(response.status).toBe(200)
  expect(readAdminPage).toHaveBeenCalledWith(expect.anything(), 'securityevents', expect.objectContaining({
    filters: expect.arrayContaining([{ field: 'type', operator: 'in', value: ['a', 'b', 'c', 'd'] }]),
  }))
})

test('rejects a query within 30 combinations that exceeds the component budget', async () => {
  const response = await GET(new Request('http://localhost/api/superadmin/security/events?type=a,b,c,d,e,f&severity=a,b,c,d,e'))
  expect(response.status).toBe(400)
  expect(getSuperadminStore).not.toHaveBeenCalled()
})
