jest.mock('next/server', () => ({ NextRequest: Request, NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } }))
jest.mock('jose', () => ({ SignJWT: jest.fn(() => ({ setProtectedHeader() { return this }, setIssuedAt() { return this }, setExpirationTime() { return this }, sign: async () => 'server-only-delegation' })) }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreSystemDatabase: jest.fn(), getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/miraAccountLink.server', () => ({ readMiraLinkGrant: jest.fn(), revokeMiraLink: jest.fn() }))
jest.mock('@/lib/miraAccess.server', () => ({ getMiraAccess: jest.fn(async () => ({ allowed: true })) }))
jest.mock('@/lib/companyFeatures.server', () => ({ checkTenantFeatureAccess: jest.fn(async () => ({ success: true })) }))
jest.mock('@/lib/permissions', () => ({ resolveUserPermissions: jest.fn(async () => ({})), checkPermission: jest.fn(() => true) }))
jest.mock('@/lib/miraContext.server', () => ({ MIRA_CONTEXT_STORE_OPTIONS: { queryFields: { tasks: ['updatedAt'] } }, fetchMiraContext: jest.fn(async () => ({ myTasks: [] })) }))
jest.mock('@/lib/miraProactive.server', () => ({ MIRA_PROACTIVE_STORE_OPTIONS: { queryFields: { tasks: ['dueDate'] } }, getMiraProactiveFeed: jest.fn(async () => ({ events: [] })) }))
jest.mock('@/lib/miraActions', () => ({ validateMiraAction: jest.fn(action => action?.type ? { action } : { error: 'Invalid action' }) }))
jest.mock('@/app/api/ai/mira-actions/route', () => ({ POST: jest.fn(async () => Response.json({ success: true, message: 'Done' })), GET: jest.fn(async () => Response.json({ success: true, found: false })) }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn(async () => ({ allowed: true })) }))
import { POST } from '@/app/api/mira/link/gateway/route'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { readMiraLinkGrant, revokeMiraLink } from '@/lib/miraAccountLink.server'
import { checkPermission } from '@/lib/permissions'
import { fetchMiraContext } from '@/lib/miraContext.server'
import { POST as actionPost, GET as actionGet } from '@/app/api/ai/mira-actions/route'
const grant = { _id: 'grant', owner: 'owner', tenant: 'talio_company_one', scopes: ['workplace:read', 'workplace:act'], authVersion: 2 }
const database = { get: jest.fn() }
const request = body => POST(new Request('https://app.talio.in/api/mira/link/gateway', { method: 'POST', headers: { authorization: 'Bearer opaque-token' }, body: JSON.stringify(body) }))
beforeEach(() => { jest.clearAllMocks(); readMiraLinkGrant.mockResolvedValue({ ...grant }); getFirestoreTenantDatabase.mockResolvedValue(database); database.get.mockResolvedValue({ _id: 'owner', name: 'Owner', role: 'employee', isActive: true, authVersion: 2 }); checkPermission.mockReturnValue(true) })
test('status ignores client identity/tenant and never exposes delegation credentials', async () => {
  const result = await request({ operation: 'status', userId: 'attacker', tenant: 'foreign' })
  expect(result.status).toBe(200); expect(await result.text()).not.toContain('server-only')
  expect(database.get).toHaveBeenCalledWith('users', 'owner')
  expect(getFirestoreTenantDatabase.mock.calls[0][0]).toBe('talio_company_one')
  expect(getFirestoreTenantDatabase.mock.calls[0][1].queryFields.tasks).toEqual(['updatedAt', 'dueDate'])
})
test.each([{ isActive: false, authVersion: 2 }, { isActive: true, authVersion: 3 }])('disabled/password-reset account fails fresh authorization', async profile => {
  database.get.mockResolvedValue(profile)
  expect((await request({ operation: 'context', query: 'tasks' })).status).toBe(401)
  expect(fetchMiraContext).not.toHaveBeenCalled()
})
test('revoked grant fails before tenant access', async () => {
  readMiraLinkGrant.mockRejectedValue(Object.assign(Error('invalid_grant'), { status: 401, code: 'invalid_grant' }))
  expect((await request({ operation: 'status' })).status).toBe(401)
  expect(database.get).not.toHaveBeenCalled()
})
test('read-only consent cannot write; confirmed writes retain scoped stable receipt identity', async () => {
  const body = { operation: 'action', action: { type: 'create_task', fields: { title: 'Test', assignees: ['me'] } }, confirmed: true, requestId: 'stable-request-identity' }
  readMiraLinkGrant.mockResolvedValue({ ...grant, scopes: ['workplace:read'] })
  expect((await request(body)).status).toBe(403); expect(actionPost).not.toHaveBeenCalled()
  readMiraLinkGrant.mockResolvedValue(grant)
  expect((await request({ ...body, confirmed: false })).status).toBe(400)
  expect((await request(body)).status).toBe(200)
  expect(await actionPost.mock.calls[0][0].json()).toMatchObject({ requestId: 'linked-grant-stable-request-identity', confirmed: true })
})
test('personal context retains role gates and cannot widen to an organization scan', async () => {
  checkPermission.mockReturnValue(false)
  expect((await request({ operation: 'context', query: 'all tasks in every organization' })).status).toBe(403)
  expect(fetchMiraContext).not.toHaveBeenCalled()
  checkPermission.mockReturnValue(true)
  await request({ operation: 'context', query: 'all tasks in every organization' })
  expect(fetchMiraContext.mock.calls[0][3]).toBe('my tasks')
})
test('arbitrary routes/tools are not accepted; receipt recovery cannot repeat writes', async () => {
  expect((await request({ operation: 'fetch', url: 'http://private.internal' })).status).toBe(400)
  expect((await request({ operation: 'action', action: { type: 'delete_user', fields: {} } })).status).toBe(400)
  expect((await request({ operation: 'receipt', requestId: 'stable-request-identity', actionType: 'create_task' })).status).toBe(200)
  expect(actionPost).not.toHaveBeenCalled()
  expect(new URL(actionGet.mock.calls[0][0].url).searchParams.get('requestId')).toBe('linked-grant-stable-request-identity')
})
test('disconnect still works after the Talio account is disabled', async () => {
  database.get.mockResolvedValue(null)
  expect((await request({ operation: 'disconnect' })).status).toBe(200)
  expect(revokeMiraLink).toHaveBeenCalledWith(undefined, grant)
  expect(database.get).not.toHaveBeenCalled()
})
