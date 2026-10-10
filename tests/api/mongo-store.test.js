import { createMongoDatabase, decodeMongoRecord, encodeMongoRecord, mongoRecordId, mongoUniqueKey } from '../../lib/platform/mongoStore.server'
import { pack, unpack, applicationRecordKey } from '../../lib/platform/firestoreCodec.cjs'
import { Binary } from 'mongodb'
import { memoryMongoDriver } from '../helpers/mongoDriver'
import { MAX_MONGO_MEMBERSHIP_VALUES } from '../../lib/platform/mongoQueryPolicy.cjs'

const copy = value => unpack(pack(value))
const get = (value, path) => path.split('.').reduce((item, key) => item?.[key], value)
const equal = (a, b) => JSON.stringify(pack(a)) === JSON.stringify(pack(b))
function matches(document, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') return condition.every(item => matches(document, item))
    if (key === '$or') return condition.some(item => matches(document, item))
    if (key === '$expr') {
      if (condition.$ne) return !equal(get(document, condition.$ne[0].slice(1)), condition.$ne[1].$literal)
      if (condition.$gt || condition.$lt) {
        const operator = condition.$gt ? '$gt' : '$lt', args = condition[operator], value = get(document, args[0].slice(1)), expected = args[1].$literal
        if (expected === null) return operator === '$gt' && value !== null && value !== undefined
        return operator === '$gt' ? value > expected : value < expected
      }
      const args = condition.$not[0].$in
      return !args[1].$literal.some(value => equal(get(document, args[0].slice(1)), value))
    }
    const value = get(document, key)
    if (!condition || typeof condition !== 'object' || condition instanceof Date || Array.isArray(condition)) return equal(value, condition)
    return Object.entries(condition).every(([op, expected]) => {
      const member = target => equal(value, target) || Array.isArray(value) && value.some(child => equal(child, target))
      if (op === '$exists') return (value !== undefined) === expected
      if (op === '$type') return expected === 'array' && Array.isArray(value)
      if (op === '$not') return expected.$type === 'array' && !Array.isArray(value)
      if (op === '$eq') return member(expected)
      if (op === '$ne') return !member(expected)
      if (op === '$in') return expected.some(member)
      if (op === '$nin') return !expected.some(member)
      if (op === '$lt') return value < expected
      if (op === '$lte') return value <= expected
      if (op === '$gt') return value > expected
      if (op === '$gte') return value >= expected
      throw new Error(`Unsupported mock operator ${op}`)
    })
  })
}
function memoryMongo() {
  let banks = new Map()
  const bank = name => { if (!banks.has(name)) banks.set(name, new Map()); return banks.get(name) }
  const calls = []
  const db = { collection(name) { return {
    async findOne(filter) { calls.push(['findOne', name, filter]); return copy([...bank(name).values()].find(doc => matches(doc, filter)) || null) },
    find(filter, options = {}) {
      calls.push(['find', name, filter, options]); let order = {}, limit = Infinity
      const cursor = {
        sort(value) { order = value; return cursor }, limit(value) { limit = value; return cursor },
        async toArray() { return [...bank(name).values()].filter(doc => matches(doc, filter)).sort((a, b) => {
          for (const [path, direction] of Object.entries(order)) { const x = get(a, path), y = get(b, path); if (x < y) return -direction; if (x > y) return direction }
          return 0
        }).slice(0, limit).map(document => options.projection ? { _id: document._id, envelope: { data: { _id: document.envelope.data._id } } } : copy(document)) },
      }
      return cursor
    },
    async countDocuments(filter) { return [...bank(name).values()].filter(doc => matches(doc, filter)).length },
    async bulkWrite(operations) { for (const operation of operations) {
      if (operation.replaceOne) bank(name).set(operation.replaceOne.replacement._id, copy(operation.replaceOne.replacement))
      else for (const [key, doc] of bank(name)) if (matches(doc, operation.deleteOne.filter)) bank(name).delete(key)
    } },
  } } }
  const client = { startSession() { return {
    async withTransaction(callback, options) {
      expect(options.readConcern.level).toBe('snapshot')
      expect(options.writeConcern.w).toBe('majority')
      const before = new Map([...banks].map(([name, docs]) => [name, new Map([...docs].map(([key, doc]) => [key, copy(doc)]))]))
      try { return await callback() } catch (error) { banks = before; throw error }
    },
    endSession: jest.fn(async () => {}),
  } } }
  return { db, client, bank, calls }
}
const dataset = 'test-mongo-store'
const options = { dataset, databaseName: 'talio_company_first', queryFields: { items: ['rank', 'tags', 'value', 'createdAt'] }, constraints: { users: [{ fields: ['email'] }] } }
let memory, store
beforeEach(() => { memory = memoryMongo(); store = createMongoDatabase({ ...memory, ...options }) })

test('lossless embedded codec keeps special values and immutable blob descriptors', () => {
  const record = { _id: 'special', absent: undefined, big: 9007199254740993n, rows: [[1, 2], [3]], bytes: Buffer.from('binary'), date: new Date('2026-10-10T00:00:00Z'), negativeZero: -0 }
  const encoded = encodeMongoRecord({ ...options, collectionName: 'items', record, envelopeMetadata: { media: { url: 'https://media.example.test/immutable' }, mediaState: 'verified' } })
  expect(decodeMongoRecord(encoded)).toEqual(record)
  expect(Object.is(decodeMongoRecord(encoded).negativeZero, -0)).toBe(true)
  expect(encoded.recordKey).toBe(applicationRecordKey('special'))
  expect(encoded.envelope.mediaState).toBe('verified')
  const binaryDocument = copy(encoded)
  binaryDocument.parts = binaryDocument.parts.map(part => ({ ...part, value: { bytes: new Binary(part.value.bytes) } }))
  expect(decodeMongoRecord(binaryDocument)).toEqual(record)
  const slicedDocument = copy(encoded)
  slicedDocument.parts = slicedDocument.parts.map(part => {
    const buffer = Buffer.concat([Buffer.from('padding'), part.value.bytes, Buffer.from('padding')])
    return { ...part, value: { bytes: new Uint8Array(buffer.buffer, buffer.byteOffset + 7, part.value.bytes.length) } }
  })
  expect(decodeMongoRecord(slicedDocument)).toEqual(record)
})

test('tenant reads, counts, and cursors cannot cross boundaries', async () => {
  const other = createMongoDatabase({ ...memory, ...options, databaseName: 'talio_company_other' })
  for (let rank = 0; rank < 5; rank++) {
    await store.create('items', { _id: `item-${rank}`, rank, secret: 'first' })
    await other.create('items', { _id: `item-${rank}`, rank, secret: 'other' })
  }
  expect((await store.get('items', 'item-0')).secret).toBe('first')
  const input = { orderBy: [{ field: 'rank', direction: 'desc' }], limit: 2 }
  const one = await store.list('items', input)
  await store.delete('items', one.records.at(-1)._id)
  const two = await store.list('items', { ...input, cursor: one.nextCursor })
  const three = await store.list('items', { ...input, cursor: two.nextCursor })
  expect([...one.records, ...two.records, ...three.records].map(row => row.rank)).toEqual([4, 3, 2, 1, 0])
  expect(three.nextCursor).toBeNull()
  await expect(other.list('items', { ...input, cursor: one.nextCursor })).rejects.toThrow('tenant/query')
  expect(await other.count('items', [{ field: 'rank', operator: '>=', value: 2 }])).toBe(3)
})

test('batched reads retain order, repeated IDs and missing IDs with a single find', async () => {
  await store.create('items', { _id: 'one', rank: 1 })
  const before = memory.calls.filter(call => call[0] === 'find').length
  expect(await store.getMany('items', ['one', 'missing', 'one'])).toEqual([{ _id: 'one', rank: 1 }, null, { _id: 'one', rank: 1 }])
  expect(memory.calls.filter(call => call[0] === 'find').length - before).toBe(1)
})

test('transaction staged reads, missing IDs, query bounds and rollback stay compatible', async () => {
  await store.create('items', { _id: 'one', rank: 1 })
  await store.create('items', { _id: 'two', rank: 2 })
  await expect(store.transaction(tx => tx.list('items', { limit: 1, requireComplete: true }))).rejects.toThrow('result bound')
  await expect(store.transaction(async tx => { await tx.create('items', { _id: 'new', rank: 3 }); await tx.list('items') })).rejects.toThrow('before staging')
  await store.transaction(async tx => {
    await tx.replace('items', { _id: 'one', rank: 4 })
    expect(await tx.getMany('items', ['one', 'missing', 'one'])).toEqual([{ _id: 'one', rank: 4 }, null])
  })
  await expect(store.transaction(async tx => { await tx.replace('items', { _id: 'one', rank: 9 }); throw new Error('abort') })).rejects.toThrow('abort')
  expect((await store.get('items', 'one')).rank).toBe(4)
  expect(await store.get('items', 'new')).toBeNull()
})

test('unique values cover imported records, staged duplicates, releases and other tenants', async () => {
  const imported = encodeMongoRecord({ ...options, collectionName: 'users', record: { _id: 'imported', email: 'same@example.test' } })
  memory.bank('talio_records').set(imported._id, imported)
  await expect(store.create('users', { _id: 'duplicate', email: 'same@example.test' })).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
  const other = createMongoDatabase({ ...memory, ...options, databaseName: 'talio_company_other' })
  await other.create('users', { _id: 'duplicate', email: 'same@example.test' })
  await store.delete('users', 'imported')
  await store.create('users', { _id: 'new', email: 'same@example.test' })
  await expect(store.transaction(async tx => { await tx.create('users', { _id: 'a', email: 'duplicate@example.test' }); await tx.create('users', { _id: 'b', email: 'duplicate@example.test' }) })).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
  expect(await store.get('users', 'a')).toBeNull()
  expect(mongoUniqueKey(dataset, options.databaseName, 'source')).not.toBe(mongoUniqueKey(dataset, 'talio_company_other', 'source'))
})

test('writes preserve migrated media metadata and refuse ID changes', async () => {
  const document = encodeMongoRecord({ ...options, collectionName: 'items', record: { _id: 'file', rank: 1 }, envelopeMetadata: { media: { objectId: 'immutable' }, mediaState: 'verified' } })
  memory.bank('talio_records').set(document._id, document)
  await store.mutate('items', 'file', record => ({ ...record, rank: 2 }))
  expect(memory.bank('talio_records').get(document._id).envelope.media).toEqual({ objectId: 'immutable' })
  await expect(store.mutate('items', 'file', record => ({ ...record, _id: 'bad' }))).rejects.toThrow('preserve the record ID')
})

test('filters preserve Firestore exclusion and array membership semantics', async () => {
  for (const record of [{ _id: 'missing' }, { _id: 'null', value: null }, { _id: 'one', value: 1, tags: ['red'] }, { _id: 'two', value: 2, tags: 'red' }]) await store.create('items', record)
  expect((await store.list('items', { filters: [{ field: 'value', operator: '!=', value: 1 }] })).records.map(row => row._id)).toEqual(['two'])
  expect((await store.list('items', { filters: [{ field: 'tags', operator: 'array-contains', value: 'red' }] })).records.map(row => row._id)).toEqual(['one'])
  expect((await store.list('items', { filters: [{ field: 'tags', operator: '==', value: 'red' }] })).records.map(row => row._id)).toEqual(['two'])
  expect((await store.list('items', { filters: [{ field: 'tags', operator: '!=', value: 'red' }] })).records.map(row => row._id)).toEqual(['one'])
  expect((await store.list('items', { filters: [{ field: 'tags', operator: 'not-in', value: ['red'] }] })).records.map(row => row._id)).toEqual(['one'])
})

test('native memberships accept 100 values without Firestore DNF batching and retain exact matching', async () => {
  await store.create('items', { _id: 'one', value: 1, tags: ['red'] })
  await store.create('items', { _id: 'two', value: 2, tags: ['blue'] })
  const values = Array.from({ length: MAX_MONGO_MEMBERSHIP_VALUES }, (_, index) => index + 100)
  values[0] = 1
  expect((await store.list('items', { filters: [{ field: 'value', operator: 'in', value: values }] })).records.map(record => record._id)).toEqual(['one'])
  expect((await store.list('items', { filters: [{ field: 'value', operator: 'not-in', value: values }] })).records.map(record => record._id)).toEqual(['two'])
  const tags = values.map(String); tags[0] = 'red'
  expect((await store.list('items', { filters: [{ field: 'tags', operator: 'array-contains-any', value: tags }] })).records.map(record => record._id)).toEqual(['one'])
  const before = memory.calls.length
  for (const operator of ['in', 'not-in', 'array-contains-any']) await expect(store.list('items', { filters: [{ field: 'value', operator, value: [...values, 999] }] })).rejects.toThrow('Invalid membership')
  expect(memory.calls).toHaveLength(before)
})

test('imported unique ownership validation reads only record IDs, not overflow bundles', async () => {
  const imported = encodeMongoRecord({ ...options, collectionName: 'users', record: { _id: 'imported', email: 'same@example.test', nested: [[1, 2]], body: 'payload'.repeat(10000) } })
  memory.bank('talio_records').set(imported._id, imported)
  await expect(store.create('users', { _id: 'duplicate', email: 'same@example.test' })).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
  expect(memory.calls.filter(call => call[0] === 'find' && call[1] === 'talio_records').at(-1)[3]).toMatchObject({ projection: { 'envelope.data._id': 1 } })
  expect(await store.get('users', 'duplicate')).toBeNull()
})

test('scope, fields, limits and operators reject invalid input before native access', async () => {
  expect(() => createMongoDatabase({ ...memory, ...options, databaseName: 'admin' })).toThrow('registered tenant')
  await expect(store.list('items', { filters: [{ field: '$where', operator: '==', value: 'x' }] })).rejects.toThrow('Invalid query field')
  await expect(store.list('items', { filters: [{ field: 'secret', operator: '==', value: 'x' }] })).rejects.toThrow('indexed schema')
  await expect(store.list('items', { limit: 101 })).rejects.toThrow('Page limit')
  expect(mongoRecordId(dataset, options.databaseName, 'items', 'x')).not.toBe(mongoRecordId(dataset, 'talio_company_other', 'items', 'x'))
})

test('native transaction reads serialize and coalesce parallel reads of the same record', async () => {
  const native = memoryMongoDriver(), repository = createMongoDatabase({ ...native, ...options })
  const doc = encodeMongoRecord({ ...options, collectionName: 'items', record: { _id: 'parallel', rank: 1 } })
  native.bank('talio_records').set(doc._id, doc)
  const result = await repository.transaction(tx => Promise.all([tx.get('items', 'parallel'), tx.get('items', 'parallel'), tx.get('items', 'missing')]))
  expect(result).toEqual([{ _id: 'parallel', rank: 1 }, { _id: 'parallel', rank: 1 }, null])
  expect(native.highest()).toBe(1)
})

test('nullable sort cursors advance from null into timestamp records', async () => {
  await store.create('items', { _id: 'null-date', createdAt: null })
  await store.create('items', { _id: 'first-date', createdAt: new Date('2026-01-01T00:00:00Z') })
  await store.create('items', { _id: 'second-date', createdAt: new Date('2026-01-02T00:00:00Z') })
  const input = { orderBy: [{ field: 'createdAt' }], limit: 1 }
  const first = await store.list('items', input)
  expect(first.records[0]._id).toBe('null-date')
  const second = await store.list('items', { ...input, cursor: first.nextCursor })
  expect(second.records[0]._id).toBe('first-date')
  const descending = { orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 1 }
  const newest = await store.list('items', descending)
  const older = await store.list('items', { ...descending, cursor: newest.nextCursor })
  const nullable = await store.list('items', { ...descending, cursor: older.nextCursor })
  expect(nullable.records[0]._id).toBe('null-date')
})
