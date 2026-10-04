import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '../../lib/platform/firestoreApplication.server'
import { WEBHOOK_STORE_OPTIONS, mutateWebhook, publicWebhook, webhookHeaders, validateWebhookUrl } from '../../lib/webhooks.server'
import { deliverAndLog, generateSignature, verifySignature } from '../../lib/webhookDispatcher'
jest.mock('../../lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@vercel/queue', () => ({ send: jest.fn() }))
jest.setTimeout(60000)
describe('webhook protocol', () => {
  test('validates HTTPS and preserves correct HMAC verification', () => {
    expect(() => validateWebhookUrl('http://example.test')).toThrow()
    expect(() => webhookHeaders({ Host: 'spoofed' })).toThrow()
    expect(webhookHeaders({ Authorization: 'test-only' })).toEqual({ Authorization: 'test-only' })
    expect(verifySignature('payload', 'test-secret', generateSignature('payload', 'test-secret'))).toBe(true)
    expect(verifySignature('different', 'test-secret', generateSignature('payload', 'test-secret'))).toBe(false)
  })
})
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
emulator('native webhook lifecycle', () => {
  let firestore, database, actor, webhook, originalFetch
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    originalFetch = global.fetch
  })
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: `test-webhooks-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, databaseName: 'talio_company_webhooks_test', ...WEBHOOK_STORE_OPTIONS })
    actor = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'admin', isActive: true }
    await database.create('users', actor)
    webhook = await mutateWebhook(database, actor, { url: 'https://example.test/receiver', events: ['leave.status.changed'] })
    getFirestoreTenantDatabase.mockResolvedValue(database)
    global.fetch = jest.fn(async () => new Response('ok', { status: 200 }))
  })
  afterEach(() => { global.fetch = originalFetch; delete process.env.TALIO_LOCAL_ACCEPTANCE })
  afterAll(async () => firestore?.terminate())
  const job = () => ({ databaseName: database.databaseName, deliveryId: 'delivery-one', webhookId: webhook._id, event: 'leave.status.changed', payload: { status: 'approved' } })
  test('uses tenant registration not queue-supplied destination and deduplicates successful deliveries', async () => {
    const input = { ...job(), url: 'https://untrusted.test', secret: 'not-authoritative' }
    await deliverAndLog(input)
    await deliverAndLog(input)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][0]).toBe(webhook.url)
    expect(global.fetch.mock.calls[0][1].headers['X-Talio-Delivery']).toBe('delivery-one')
    expect((await database.list('webhookdeliverylogs')).records[0]).toMatchObject({ status: 'success', leaseToken: null })
    expect(publicWebhook(webhook)).not.toHaveProperty('secret')
  })
  test('revoked registrations cannot deliver queued messages and audit logs remain', async () => {
    await deliverAndLog(job())
    await mutateWebhook(database, actor, {}, webhook._id, 'delete')
    await deliverAndLog({ ...job(), deliveryId: 'second' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect((await database.list('webhookdeliverylogs')).records).toHaveLength(1)
  })
  test('failures are persisted and retry succeeds without concurrent delivery', async () => {
    global.fetch.mockResolvedValueOnce(new Response('no', { status: 503 }))
    await expect(deliverAndLog(job())).rejects.toThrow('HTTP 503')
    expect((await database.list('webhookdeliverylogs')).records[0]).toMatchObject({ status: 'retrying', leaseToken: null })
    await deliverAndLog(job(), 2)
    expect((await database.get('webhooks', webhook._id)).failureCount).toBe(0)
  })
  test('local acceptance mode never calls external delivery', async () => {
    process.env.TALIO_LOCAL_ACCEPTANCE = '1'
    expect(await deliverAndLog(job())).toMatchObject({ skipped: true })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
