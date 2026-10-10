jest.mock('next/server', () => ({ NextResponse: {
  next: jest.fn((options = {}) => ({ type: 'next', options })),
  json: jest.fn((body, options = {}) => ({ type: 'json', body, options })),
  redirect: jest.fn(),
} }))
jest.mock('jose', () => ({ jwtVerify: jest.fn() }))
import { middleware } from '@/middleware'
import {
  isMigrationProducerPaused, isMigrationDrainCallback, assertMigrationWritesAllowed,
} from '@/lib/platform/migrationFence.cjs'
import fs from 'node:fs'
import path from 'node:path'

const originalVercel = process.env.VERCEL

const request = (pathname, method = 'GET', headers = {}) => ({
  method, nextUrl: { pathname }, headers: new Headers(headers), cookies: { get: () => null },
})

describe('producer-only migration maintenance', () => {
  afterEach(() => {
    delete process.env.TALIO_MIGRATION_PRODUCER_PAUSE
    delete process.env.TALIO_MIGRATION_FREEZE
    if (originalVercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = originalVercel
  })

  test('opt-in is separate from the full database write fence', () => {
    expect(isMigrationProducerPaused({})).toBe(false)
    expect(isMigrationProducerPaused({ TALIO_MIGRATION_PRODUCER_PAUSE: '0' })).toBe(false)
    expect(isMigrationProducerPaused({ TALIO_MIGRATION_PRODUCER_PAUSE: '1' })).toBe(true)
    expect(() => assertMigrationWritesAllowed({ TALIO_MIGRATION_PRODUCER_PAUSE: '1' })).not.toThrow()
  })

  test.each(['/api/queues/background', '/api/queues/webhooks'])(
    'allows exact private Vercel POST callback through to unchanged handler: %s', async pathname => {
      process.env.TALIO_MIGRATION_PRODUCER_PAUSE = '1'
      process.env.VERCEL = '1'
      expect(isMigrationDrainCallback(pathname, 'POST')).toBe(true)
      const response = await middleware(request(pathname, 'POST'))
      expect(response.type).toBe('next')
      // No identity is fabricated or callback result/acknowledgement synthesized.
      expect(response.options).toEqual({})
    },
  )

  test('both drain exceptions remain bound to private queue/v2beta production triggers', () => {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'))
    for (const name of ['background', 'webhooks']) {
      const triggers = config.functions[`app/api/queues/${name}/route.js`].experimentalTriggers
      expect(triggers).toEqual([expect.objectContaining({
        type: 'queue/v2beta', topic: `talio-${name}`,
      })])
    }
  })

  test('local public handlers cannot use the private callback exception', async () => {
    process.env.TALIO_MIGRATION_PRODUCER_PAUSE = '1'
    process.env.VERCEL = '0'
    expect((await middleware(request('/api/queues/background', 'POST'))).options.status).toBe(503)
  })

  test.each([
    ['/api/auth/login', 'POST'], ['/api/cron/auto-checkout', 'GET'],
    ['/api/images/variant', 'GET'], ['/api/superadmin/companies', 'DELETE'],
    ['/api/socketio', 'GET'], ['/api/integrations/wordpress/webhook', 'POST'],
    ['/api/queues/background', 'GET'], ['/api/queues/webhooks', 'PUT'],
    ['/api/queues/background/other', 'POST'], ['/api/queues/webhooks/', 'POST'],
    ['/api/health', 'POST'], ['/api/health/anything', 'GET'],
  ])('blocks external/cron/GET writer or non-exact callback %s %s', async (pathname, method) => {
    process.env.TALIO_MIGRATION_PRODUCER_PAUSE = '1'
    process.env.VERCEL = '1'
    const response = await middleware(request(pathname, method, {
      'x-talio-migration-consumer': '1', 'x-verified-role': 'admin',
    }))
    expect(response.type).toBe('json')
    expect(response.options.status).toBe(503)
    expect(response.options.headers['Retry-After']).toBe('60')
    expect(response.options.headers['Cache-Control']).toBe('no-store')
    expect(response.body.code).toBe('MIGRATION_PRODUCER_PAUSE')
  })

  test('health remains exact, read-only and unauthenticated', async () => {
    process.env.TALIO_MIGRATION_PRODUCER_PAUSE = '1'
    expect((await middleware(request('/api/health'))).type).toBe('next')
  })

  test.each(['/api/queues/background', '/api/queues/webhooks'])(
    'full freeze takes precedence over draining exceptions %s', async pathname => {
      process.env.TALIO_MIGRATION_PRODUCER_PAUSE = '1'
      process.env.TALIO_MIGRATION_FREEZE = '1'
      const response = await middleware(request(pathname, 'POST'))
      expect(response.options.status).toBe(503)
      expect(response.body.code).toBe('MIGRATION_WRITE_FENCE')
    },
  )

  test('turning producer pause off restores existing auth, not a queue bypass', async () => {
    process.env.TALIO_MIGRATION_PRODUCER_PAUSE = '0'
    expect((await middleware(request('/api/queues/background', 'POST'))).options.status).toBe(401)
  })
})
