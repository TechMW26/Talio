jest.mock('@/lib/platform/firestoreAuth.server', () => ({ getNativeAuthRepository: jest.fn(), parseSessionUserAgent: jest.fn(() => ({ browser: 'Fixture' })) }))
jest.mock('@/lib/tenantContext', () => ({ getTenantByEmail: jest.fn(), updateUserLoginStats: jest.fn(async () => {}), checkServiceStatus: jest.fn(async () => ({ active: true })) }))
jest.mock('@/lib/permissions', () => ({ resolveUserPermissions: jest.fn(async () => ({ dashboard: { view_dashboard: true } })) }))
jest.mock('@/lib/mailer', () => ({ sendLoginAlertEmail: jest.fn(async () => {}) }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn(async () => ({ allowed: true })), buildRateLimitHeaders: jest.fn() }))
jest.mock('@/lib/security/auditLog', () => ({ recordSecurityEvent: jest.fn(), extractClientIp: jest.fn(() => 'fixture-ip') }))
jest.mock('@/lib/security/ipBlocklist', () => ({ isIpBlocked: jest.fn(async () => false), blockIp: jest.fn() }))
jest.mock('jose', () => ({ SignJWT: class { setProtectedHeader() { return this } setIssuedAt() { return this } setExpirationTime() { return this } async sign() { return 'fixture-signed-token' } } }))
import { POST } from '@/app/api/auth/login/route'
import { getNativeAuthRepository } from '@/lib/platform/firestoreAuth.server'
import { getTenantByEmail } from '@/lib/tenantContext'
import { resolveUserPermissions } from '@/lib/permissions'

describe('native Firestore login contract', () => {
  let repository, user
  const request = password => new Request('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'employee@example.test', password }) })
  beforeEach(() => {
    process.env.JWT_SECRET = 'fixture-only-long-jwt-secret'
    user = { _id: 'user', email: 'employee@example.test', password: 'fixture-secret', role: 'employee', isActive: true, forcePasswordChange: true }
    repository = { findUser: jest.fn(async () => user), completeLogin: jest.fn(async () => ({ ...user, lastLogin: new Date() })), recordFailedLogin: jest.fn(async () => ({ loginAttempts: 1 })), createSession: jest.fn(), getCompanySettings: jest.fn(async () => ({ notifications: { emailNotifications: false } })), sendLoginPush: jest.fn(), getHeadDepartments: jest.fn(async () => []) }
    getNativeAuthRepository.mockResolvedValue(repository)
    getTenantByEmail.mockResolvedValue({ databaseName: 'talio_company_fixture', companySlug: 'fixture', companyName: 'Fixture' })
    resolveUserPermissions.mockResolvedValue({ dashboard: { view_dashboard: true } })
  })
  test('successful login issues the existing token/user shape only after session persistence', async () => {
    const response = await POST(request('fixture-secret'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.user).toMatchObject({ id: 'user', forcePasswordChange: true, tenant: { databaseName: 'talio_company_fixture' } })
    expect(body.user.password).toBeUndefined()
    expect(repository.createSession).toHaveBeenCalledWith(expect.objectContaining({ user: 'user', tokenId: expect.any(String) }))
    expect(response.headers.get('set-cookie')).toContain('token=')
  })
  test('incorrect password atomically records an attempt without creating session', async () => {
    const response = await POST(request('wrong'))
    expect(response.status).toBe(401)
    expect(repository.recordFailedLogin).toHaveBeenCalledWith('user', 5, 15 * 60000)
    expect(repository.createSession).not.toHaveBeenCalled()
  })
  test('deactivated accounts cannot start login transaction', async () => {
    user.isActive = false
    expect((await POST(request('fixture-secret'))).status).toBe(401)
    expect(repository.completeLogin).not.toHaveBeenCalled()
  })
  test('native session persistence and custom permission failures never issue a token', async () => {
    repository.createSession.mockRejectedValueOnce(new Error('UNAVAILABLE'))
    expect((await POST(request('fixture-secret'))).status).toBe(503)
    resolveUserPermissions.mockRejectedValueOnce(new Error('role unavailable'))
    expect((await POST(request('fixture-secret'))).status).toBe(503)
  })
})
