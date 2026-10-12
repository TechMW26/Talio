jest.mock('jose', () => ({ jwtVerify: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/companyFeatures.server', () => ({ checkTenantFeatureAccess: jest.fn() }))
import { jwtVerify } from 'jose'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { checkTenantFeatureAccess } from '@/lib/companyFeatures.server'
import { verifyToken, verifyTokenFromRequest } from '@/lib/auth'

let database
beforeEach(() => {
  jest.clearAllMocks(); globalThis.__authTokenCache?.clear(); process.env.JWT_SECRET = 'fixture'
  jwtVerify.mockResolvedValue({ payload: { userId: 'user', databaseName: 'talio_company_one', companySlug: 'one' } })
  database = { get: jest.fn(async collection => ({ users: { _id: 'user', role: 'admin', employeeId: 'employee', isActive: true }, servicesettings: { enabled: true, allowedLevels: [9] }, employees: { designation: 'designation' }, designations: { level: 6 } })[collection]) }
  getFirestoreTenantDatabase.mockResolvedValue(database)
  checkTenantFeatureAccess.mockResolvedValue({ success: true })
})
const request = path => new Request(`https://app.talio.in${path}`, { headers: { Authorization: 'Bearer fixture' } })
test.each(['/api/ai/mira-chat', '/api/ai/mira-images', '/api/ai/mira-actions', '/api/ai/mira-agent/llm'])('fresh designation restrictions cover %s including legacy auth entry points', async path => {
  expect(await verifyTokenFromRequest(request(path))).toMatchObject({ success: false, status: 403, code: 'MIRA_ACCESS_DISABLED' })
  expect(database.get).toHaveBeenCalledWith('designations', 'designation')
})
test('administrator can recover access after disabling their own level', async () => {
  expect((await verifyTokenFromRequest(request('/api/mira/access'))).success).toBe(true)
  expect(database.get).not.toHaveBeenCalledWith('servicesettings', 'mira')
})
test('tenant plan restrictions still apply to every voice entry point', async () => {
  checkTenantFeatureAccess.mockResolvedValue({ success: false, status: 403, message: 'Plan disabled' })
  expect(await verifyTokenFromRequest(request('/api/ai/mira-agent/session'))).toMatchObject({ success: false, status: 403 })
})
test('a voice credential cannot become a Talio login even if incorrectly signed with the login key', async () => {
  jwtVerify.mockResolvedValue({ payload: { purpose: 'mira-voice-bridge', aud: 'mira-voice-bridge', userId: 'user', databaseName: 'talio_company_one' } })
  expect(await verifyToken('different-fixture')).toBeNull()
  expect(getFirestoreTenantDatabase).not.toHaveBeenCalled()
})
