import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase, createTenantFirestoreStore, getFirestoreMembershipBatchSize } from '../../lib/platform/firestoreStore.server'
import { encodeApplicationRecord, applicationRecordKey } from '../../lib/platform/firestoreCodec.cjs'
import { acquireFirestoreLease, releaseFirestoreLease } from '../../lib/platform/firestoreLease.server'

jest.setTimeout(45000)

const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip

test('membership batches reserve compound filters, implicit ranges and search overflow disjunctions', () => {
  expect(getFirestoreMembershipBatchSize()).toBe(30)
  expect(getFirestoreMembershipBatchSize([{ field: 'status', operator: '==', value: 'active' }])).toBe(25)
  expect(getFirestoreMembershipBatchSize([{ field: 'status', operator: 'in', value: ['pending', 'submitted'] }], [{ field: 'createdAt', direction: 'desc' }])).toBe(10)
  expect(getFirestoreMembershipBatchSize([{ field: 'status', operator: '==' }, { field: 'startDate', operator: '<=' }, { field: 'endDate', operator: '>=' }])).toBe(12)
  expect(getFirestoreMembershipBatchSize([{ field: 'searchGrams', operator: 'array-contains', value: 'abc' }])).toBe(12)
})

emulator('native repositories against the isolated Firestore emulator', () => {
  let firestore, first, second, dataset
  beforeAll(() => {
    // Refuse accidental cloud writes even if the local environment has credentials.
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    dataset = `test-store-${Date.now()}`
    const constraints = { users: [{ fields: ['email'] }] }
    const queryFields = { items: ['rank', 'startAt', 'endAt'], announcements: ['searchGrams'], jobpostings: ['applicationDeadline'], candidates: ['rating'], onboardingemails: ['sentAt'], projectemailnotificationlogs: ['sentAt'] }
    first = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_first', constraints, queryFields })
    second = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_second', constraints, queryFields })
  })
  afterAll(async () => { await firestore?.terminate() })

  test('preserves tenant isolation for identical IDs, reads, counts and cursors', async () => {
    for (let i = 0; i < 5; i++) {
      await first.create('items', { _id: `item-${i}`, rank: i, secret: 'first' })
      await second.create('items', { _id: `item-${i}`, rank: i, secret: 'second' })
    }
    expect((await first.get('items', 'item-0')).secret).toBe('first')
    expect((await second.get('items', 'item-0')).secret).toBe('second')
    const options = { orderBy: [{ field: 'rank' }], limit: 2 }
    const page1 = await first.list('items', options)
    const page2 = await first.list('items', { ...options, cursor: page1.nextCursor })
    const page3 = await first.list('items', { ...options, cursor: page2.nextCursor })
    expect([...page1.records, ...page2.records, ...page3.records].map(item => item.rank)).toEqual([0, 1, 2, 3, 4])
    expect(page3.nextCursor).toBeNull()
    await expect(second.list('items', { ...options, cursor: page1.nextCursor })).rejects.toThrow('tenant/query')
    expect(await first.count('items', [{ field: 'rank', operator: '>=', value: 2 }])).toBe(3)
  })
  test('reads and updates fragmented payloads atomically with no lost concurrent changes', async () => {
    await first.create('boards', { _id: 'board', count: 0, rows: [[1, 2], [3, 4]] })
    await Promise.all(Array.from({ length: 3 }, () => first.mutate('boards', 'board', value => ({ ...value, count: value.count + 1 }))))
    expect(await first.get('boards', 'board')).toEqual({ _id: 'board', count: 3, rows: [[1, 2], [3, 4]] })
    await first.mutate('boards', 'board', value => ({ ...value, rows: 'now-inline' }))
    expect((await first.get('boards', 'board')).rows).toBe('now-inline')
    await first.delete('boards', 'board')
    expect(await first.get('boards', 'board')).toBeNull()
  })
  test('enforces unique keys under concurrent registration and releases them on deletion', async () => {
    const results = await Promise.allSettled(['a', 'b'].map(_id => first.create('users', { _id, email: 'same@example.test' })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')[0].reason.code).toBe('ALREADY_EXISTS')
    await second.create('users', { _id: 'a', email: 'same@example.test' })
    const winner = results[0].status === 'fulfilled' ? 'a' : 'b'
    await first.delete('users', winner)
    await first.create('users', { _id: 'c', email: 'same@example.test' })
  })
  test('enforces imported unique values even before claims have been populated', async () => {
    const record = { _id: 'imported-user', email: 'imported@example.test' }
    const reference = firestore.collection('talioDatasets').doc(dataset).collection('databases').doc('talio_company_first').collection('collections').doc('users').collection('records').doc(applicationRecordKey(record._id))
    await reference.create(encodeApplicationRecord(record).envelope)
    await expect(first.create('users', { _id: 'duplicate-user', email: record.email })).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
    expect(await first.get('users', 'duplicate-user')).toBeNull()
  })
  test('concurrent native workers cannot both own the same job lease', async () => {
    const results = await Promise.all(['worker-a', 'worker-b'].map(owner => acquireFirestoreLease(first, 'job:one', { owner, ttlMs: 60000 })))
    expect(results.filter(Boolean)).toHaveLength(1)
    const winner = results.find(Boolean)
    expect(await releaseFirestoreLease(first, { ...winner, owner: 'wrong-worker' })).toBe(false)
    expect(await releaseFirestoreLease(first, winner)).toBe(true)
  })
  test('rolls back cross-record changes on a failed transaction', async () => {
    await expect(first.transaction(async tx => {
      await tx.create('items', { _id: 'rollback', rank: 7 })
      await tx.replace('items', { _id: 'item-0', rank: 999 })
      throw new Error('Rejected workflow')
    })).rejects.toThrow('Rejected workflow')
    expect(await first.get('items', 'rollback')).toBeNull()
    expect((await first.get('items', 'item-0')).rank).toBe(0)
  })
  test('transaction queries are scoped, bounded and read before mutation', async () => {
    const result = await first.transaction(async tx => {
      const page = await tx.list('items', { filters: [{ field: 'rank', operator: '==', value: 0 }], limit: 2, requireComplete: true })
      expect(page.hasMore).toBe(false)
      expect(page.records).toHaveLength(1)
      await tx.replace('items', { ...page.records[0], touched: true })
      return page.records[0].secret
    })
    expect(result).toBe('first')
    expect((await first.get('items', 'item-0')).touched).toBe(true)
    expect((await second.get('items', 'item-0')).touched).toBeUndefined()
    await expect(first.transaction(tx => tx.list('items', { limit: 2, requireComplete: true }))).rejects.toThrow('result bound')
    await expect(first.transaction(async tx => {
      await tx.replace('items', { _id: 'item-0', rank: 123 })
      await tx.list('items')
    })).rejects.toThrow('before staging writes')
    expect((await first.get('items', 'item-0')).rank).toBe(0)
    await expect(first.transaction(tx => tx.list('items', { filters: [{ field: 'secret', operator: '==', value: 'first' }] }))).rejects.toThrow('indexed schema')
  })
  test('rejects injection, invalid filters, unbounded reads and missing verified auth', async () => {
    await expect(first.get('items', '../other')).rejects.toThrow('Invalid record ID')
    await expect(first.list('items', { limit: 10000 })).rejects.toThrow('Page limit')
    await expect(first.list('items', { limit: 10000 })).rejects.toMatchObject({ status: 400 })
    await expect(first.list('items', { filters: [{ field: 'rank', operator: '$where', value: 1 }] })).rejects.toThrow('Unsupported')
    await expect(first.list('items', { filters: [{ field: 'rank', operator: 'in', value: Array.from({ length: 16 }, (_, i) => i) }, { field: 'startAt', operator: 'in', value: [1, 2] }] })).rejects.toThrow('30 membership disjunctions')
    await expect(first.list('items', { filters: [{ field: 'rank', operator: 'array-contains', value: 1 }, { field: 'startAt', operator: 'array-contains-any', value: [1] }] })).rejects.toThrow('one array membership')
    await expect(first.list('items', { filters: [{ field: 'rank', operator: 'not-in', value: [1] }, { field: 'startAt', operator: '!=', value: 1 }] })).rejects.toThrow('one exclusion')
    await expect(first.list('items', { filters: [{ field: 'rank', operator: 'not-in', value: [1] }, { field: 'startAt', operator: 'in', value: [1] }] })).rejects.toThrow('not-in cannot')
    await expect(first.list('items', { filters: [{ field: 'rank', operator: 'in', value: Array.from({ length: 26 }, (_, i) => i) }, { field: 'startAt', operator: '>=', value: new Date(0) }, { field: 'endAt', operator: '<=', value: new Date() }, { field: 'rank', operator: '!=', value: -1 }] })).rejects.toThrow('100-component')
    await expect(first.list('items', { filters: [{ field: 'rank', operator: 'in', value: Array.from({ length: 26 }, (_, i) => i) }, { field: 'startAt', operator: '==', value: 1 }] })).rejects.toMatchObject({ status: 400 })
    expect(() => createTenantFirestoreStore({ firestore, dataset: 'test-invalid', auth: { success: false } })).toThrow('Verified tenant')
    expect(() => createFirestoreDatabase({ firestore, dataset: 'test-invalid', databaseName: 'talio_superadmin' })).toThrow('registered tenant')
  })
  test('range pagination remains valid when its previous anchor is deleted', async () => {
    for (let rank = 0; rank < 4; rank++) await first.create('items', { _id: `retention-${rank}`, rank: 100 + rank })
    const options = { filters: [{ field: 'rank', operator: '>=', value: 100 }], limit: 2 }
    const page = await first.list('items', options)
    expect(page.records.map(record => record.rank)).toEqual([100, 101])
    await first.delete('items', page.records[1]._id)
    const next = await first.list('items', { ...options, cursor: page.nextCursor })
    expect(next.records.map(record => record.rank)).toEqual([102, 103])
  })
  test('indexed overflow candidates remain searchable beyond the gram bound', async () => {
    const content = `${Array.from({ length: 1500 }, (_, i) => i.toString(36).padStart(3, '0')).join(' ')} needle`
    await first.create('announcements', { _id: 'long-search', title: 'Long record', content })
    await first.create('announcements', { _id: 'short-search', title: 'Short needle', content: 'short' })
    await first.create('announcements', { _id: 'unrelated-search', title: 'Unrelated', content: 'short' })
    const filters = [{ field: 'searchGrams', operator: 'array-contains', value: 'nee' }]
    const page = await first.list('announcements', { filters, limit: 1 })
    const next = await first.list('announcements', { filters, limit: 1, cursor: page.nextCursor })
    expect([...page.records, ...next.records].map(row => row._id).sort()).toEqual(['long-search', 'short-search'])
    expect((await first.get('announcements', 'long-search')).content).toBe(content)
    expect(filters[0].operator).toBe('array-contains')
  })
  test('date range cursors include every inequality sort and survive deleted anchors', async () => {
    const startAt = new Date('2026-10-03T10:00:00Z')
    for (let i = 1; i <= 3; i++) await first.create('items', { _id: `dated-${i}`, rank: 200, startAt, endAt: new Date(startAt.getTime() + i * 60000) })
    const options = { filters: [{ field: 'startAt', operator: '>=', value: startAt }, { field: 'endAt', operator: '>', value: startAt }], orderBy: [{ field: 'startAt', direction: 'desc' }], limit: 1 }
    const page = await first.list('items', options)
    expect(page.records[0]._id).toBe('dated-3')
    await first.delete('items', 'dated-3')
    const secondPage = await first.list('items', { ...options, cursor: page.nextCursor })
    expect(secondPage.records[0]._id).toBe('dated-2')
    const last = await first.list('items', { ...options, cursor: secondPage.nextCursor })
    expect(last.records[0]._id).toBe('dated-1'); expect(last.nextCursor).toBeNull()
    expect(await first.count('items', options.filters)).toBe(2)
  })
  test('optional sort projections keep unsent and incomplete records in paginated results', async () => {
    for (const [collection, field] of [['jobpostings', 'applicationDeadline'], ['candidates', 'rating'], ['onboardingemails', 'sentAt'], ['projectemailnotificationlogs', 'sentAt']]) {
      const value = field === 'rating' ? 5 : new Date('2026-10-03T10:00:00Z')
      await first.create(collection, { _id: 'missing-sort', status: 'pending' })
      await first.create(collection, { _id: 'present-sort', status: 'sent', [field]: value })
      const options = { orderBy: [{ field, direction: 'desc' }], limit: 1 }
      const page = await first.list(collection, options)
      expect(page.records[0]._id).toBe('present-sort')
      const next = await first.list(collection, { ...options, cursor: page.nextCursor })
      expect(next.records[0]._id).toBe('missing-sort')
      expect(next.records[0][field]).toBeNull()
      expect(next.nextCursor).toBeNull()
    }
  })
})

describe('Firestore repository configuration fails closed', () => {
  test('requires an explicit dataset and tenant path', () => {
    expect(() => createFirestoreDatabase({ firestore: {}, databaseName: 'talio_company_test' })).toThrow('FIRESTORE_DATASET')
    expect(() => createFirestoreDatabase({ firestore: {}, dataset: 'local-test-01', databaseName: 'admin' })).toThrow('registered tenant')
  })
})
