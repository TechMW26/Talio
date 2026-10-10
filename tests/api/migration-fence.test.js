jest.mock('next/server', () => ({ NextResponse: {
  next: jest.fn((options = {}) => ({ type: 'next', options })),
  json: jest.fn((body, options = {}) => ({ type: 'json', body, options })),
  redirect: jest.fn(),
} }))
jest.mock('jose', () => ({ jwtVerify: jest.fn() }))
import { middleware } from '@/middleware'
import { isMigrationFrozen, assertMigrationWritesAllowed } from '@/lib/platform/migrationFence.cjs'

const request = (pathname, method = 'GET') => ({ method, nextUrl: { pathname }, headers: new Headers(), cookies: { get: () => null } })
describe('migration write fence', () => {
  afterEach(() => { delete process.env.TALIO_MIGRATION_FREEZE })
  test('explicit opt-in only', () => {
    expect(isMigrationFrozen({})).toBe(false)
    expect(isMigrationFrozen({ TALIO_MIGRATION_FREEZE: '0' })).toBe(false)
    expect(() => assertMigrationWritesAllowed({ TALIO_MIGRATION_FREEZE: '1' })).toThrow(/migration/)
  })
  test.each(['/api/auth/login', '/api/cron/auto-checkout', '/api/queues/background', '/api/images/a', '/api/superadmin/companies', '/api/socketio', '/api/integrations/wordpress/webhook'])(
    'blocks all API writer planes including GET %s', async pathname => {
      process.env.TALIO_MIGRATION_FREEZE = '1'
      const response = await middleware(request(pathname))
      expect(response.type).toBe('json')
      expect(response.options.status).toBe(503)
      expect(response.options.headers['Retry-After']).toBe('60')
      expect(response.body.code).toBe('MIGRATION_WRITE_FENCE')
    },
  )
  test('only exact read-only GET health can pass', async () => {
    process.env.TALIO_MIGRATION_FREEZE = '1'
    expect((await middleware(request('/api/health'))).type).toBe('next')
    expect((await middleware(request('/api/health', 'POST'))).options.status).toBe(503)
    expect((await middleware(request('/api/health/anything'))).options.status).toBe(503)
  })
})
