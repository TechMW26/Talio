import { FieldPath } from 'firebase-admin/firestore'
import { createMongoFirestoreFacade } from '../../lib/platform/mongoFirestoreFacade.server'
import { encodeMongoRecord, decodeMongoRecord, mongoRecordId, mongoUniqueKey } from '../../lib/platform/mongoStore.server'
import { encodeApplicationRecord, decodeApplicationRecord, pack, unpack } from '../../lib/platform/firestoreCodec.cjs'
import { memoryMongoDriver as fakeMongo } from '../helpers/mongoDriver'

const dataset = 'test-mongo-facade', databaseName = 'talio_company_first'
let native, facade, root
const records = (root, name, dbName = databaseName) => root.collection('databases').doc(dbName).collection('collections').doc(name).collection('records')
beforeEach(() => { native = fakeMongo(); facade = createMongoFirestoreFacade({ ...native, dataset }); root = facade.collection('talioDatasets').doc(dataset) })

test('direct workflow snapshots and equality FieldPaths use native shared records', async () => {
  const doc = encodeMongoRecord({ dataset, databaseName, collectionName: 'users', record: { _id: 'a'.repeat(24), email: 'user@example.test', profile: { flags: [[1, 2]] } } })
  native.bank('talio_records').set(doc._id, doc)
  const found = await records(root, 'users').where(new FieldPath('data', 'email'), '==', 'user@example.test').limit(2).get()
  expect(found.size).toBe(1)
  expect(found.empty).toBe(false)
  const snapshot = found.docs[0]
  expect(snapshot.id).toBe('a'.repeat(24))
  expect(snapshot.get(new FieldPath('data', 'email'))).toBe('user@example.test')
  const partRefs = doc.parts.map(part => snapshot.ref.collection('parts').doc(part.id))
  const parts = await facade.getAll(...partRefs)
  expect(decodeApplicationRecord(snapshot.data(), new Map(parts.map(part => [part.id, part.data()])))).toEqual(decodeMongoRecord(doc))
})

test('record envelope + synthetic parts writes commit once and preserve media', async () => {
  const id = 'b'.repeat(24), reference = records(root, 'users').doc(id)
  const original = encodeMongoRecord({ dataset, databaseName, collectionName: 'users', record: { _id: id, profile: [[1]] }, envelopeMetadata: { media: { objectId: 'keep' }, mediaState: 'verified' } })
  native.bank('talio_records').set(original._id, original)
  const next = { _id: id, profile: [[3, 4]] }, encoded = encodeApplicationRecord(next)
  await facade.runTransaction(async tx => {
    expect((await tx.get(reference)).exists).toBe(true)
    tx.set(reference, encoded.envelope)
    for (const part of encoded.parts) tx.set(reference.collection('parts').doc(part.id), part.value)
    for (const part of original.parts) if (!encoded.parts.some(nextPart => nextPart.id === part.id)) tx.delete(reference.collection('parts').doc(part.id))
  })
  const saved = native.bank('talio_records').get(original._id)
  expect(decodeMongoRecord(saved)).toEqual(next)
  expect(saved.envelope.media).toEqual({ objectId: 'keep' })
  expect(native.bank('talio_records').size).toBe(1)
})

test('cross-scope claims and catalog changes commit atomically without a duplicate bank', async () => {
  native.bank('talio_catalogs').set(dataset, { _id: dataset, status: 'ready', tenants: [] })
  const claim = root.collection('databases').doc('talio_superadmin').collection('uniqueKeys').doc('a'.repeat(64))
  await facade.runTransaction(async tx => {
    expect((await tx.get(root)).get('status')).toBe('ready')
    expect((await tx.get(claim)).exists).toBe(false)
    tx.create(claim, { owner: 'users/abc' })
    tx.update(root, { tenants: [{ tenantId: 'id', databaseName, active: true }] })
  })
  expect(native.bank('talio_unique_keys').get(mongoUniqueKey(dataset, 'talio_superadmin', 'a'.repeat(64))).owner).toBe('users/abc')
  expect((await root.get()).get('tenants')).toHaveLength(1)
  await expect(facade.runTransaction(async tx => { tx.update(root, { status: 'wrong' }); tx.create(claim, { owner: 'other' }) })).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
  expect((await root.get()).get('status')).toBe('ready')
})

test('creation and deletion include overflow parts in the same document', async () => {
  const record = { _id: 'c'.repeat(24), nested: [[1, 2]] }, encoded = encodeApplicationRecord(record), reference = records(root, 'items').doc(record._id)
  await facade.runTransaction(tx => {
    tx.create(reference, encoded.envelope)
    for (const part of encoded.parts) tx.set(reference.collection('parts').doc(part.id), part.value)
  })
  expect(decodeMongoRecord(native.bank('talio_records').get(mongoRecordId(dataset, databaseName, 'items', record._id)))).toEqual(record)
  await facade.runTransaction(tx => { tx.delete(reference); for (const part of encoded.parts) tx.delete(reference.collection('parts').doc(part.id)) })
  expect((await reference.get()).exists).toBe(false)
})

test('parallel workflow reads are serialized within native sessions', async () => {
  await facade.runTransaction(tx => Promise.all(['one', 'two', 'three'].map(id => tx.get(records(root, 'items').doc(id)))))
  expect(native.highest()).toBe(1)
})

test('uncached staged records and synthetic parts are preloaded in one bounded parent batch', async () => {
  const original = native.db.collection.bind(native.db), find = jest.fn(), findOne = jest.fn()
  native.db.collection = name => {
    const collection = original(name)
    return { ...collection, find: (...args) => { find(name, ...args); return collection.find(...args) }, findOne: (...args) => { findOne(name, ...args); return collection.findOne(...args) } }
  }
  facade = createMongoFirestoreFacade({ ...native, dataset }); root = facade.collection('talioDatasets').doc(dataset)
  await facade.runTransaction(tx => {
    for (let index = 0; index < 32; index++) {
      const record = { _id: index.toString(16).padStart(24, '0'), nested: [[index]] }, encoded = encodeApplicationRecord(record), reference = records(root, 'items').doc(record._id)
      tx.create(reference, encoded.envelope)
      for (const part of encoded.parts) tx.set(reference.collection('parts').doc(part.id), part.value)
    }
  })
  expect(find).toHaveBeenCalledTimes(1)
  expect(find.mock.calls[0][1]).toMatchObject({ dataset, _id: { $in: expect.any(Array) } })
  expect(find.mock.calls[0][1]._id.$in).toHaveLength(32)
  expect(findOne).not.toHaveBeenCalled()
  expect(native.bank('talio_records').size).toBe(32)
  expect([...native.bank('talio_records').values()].map(decodeMongoRecord).every(record => record.nested[0][0] >= 0)).toBe(true)
})

test('bounded count aggregates retain tenant/session scope without hydrating record bundles', async () => {
  const original = native.db.collection.bind(native.db), count = jest.fn(), find = jest.fn()
  for (let index = 0; index < 5; index++) {
    const doc = encodeMongoRecord({ dataset, databaseName, collectionName: 'users', record: { _id: index.toString(16).padStart(24, '0'), isActive: true, overflow: [[index]] } })
    native.bank('talio_records').set(doc._id, doc)
  }
  const foreign = encodeMongoRecord({ dataset, databaseName: 'talio_company_other', collectionName: 'users', record: { _id: 'f'.repeat(24), isActive: true } })
  native.bank('talio_records').set(foreign._id, foreign)
  native.db.collection = name => {
    const collection = original(name)
    return { ...collection, countDocuments: (...args) => { count(...args); return collection.countDocuments(...args) }, find: (...args) => { find(...args); return collection.find(...args) } }
  }
  facade = createMongoFirestoreFacade({ ...native, dataset }); root = facade.collection('talioDatasets').doc(dataset)
  const aggregate = records(root, 'users').where(new FieldPath('data', 'isActive'), '==', true).limit(3).count()
  expect((await facade.runTransaction(tx => tx.get(aggregate), { readOnly: true })).data()).toEqual({ count: 3 })
  expect(count).toHaveBeenCalledWith(expect.objectContaining({ dataset, databaseName, collectionName: 'users' }), expect.objectContaining({ session: expect.anything(), limit: 3 }))
  expect(find).not.toHaveBeenCalled()
  expect(() => records(root, 'users').count()).toThrow('explicit query limit')
})

test('batched facade reads preserve full namespace checks even for a corrupted keyed document', async () => {
  const id = 'd'.repeat(24), reference = records(root, 'users').doc(id)
  const wrongScope = encodeMongoRecord({ dataset, databaseName, collectionName: 'users', record: { _id: id, email: 'private@example.test' } })
  wrongScope.databaseName = 'talio_company_other'
  native.bank('talio_records').set(wrongScope._id, wrongScope)
  expect((await reference.get()).exists).toBe(false)
  expect((await facade.getAll(reference))[0].exists).toBe(false)
  await facade.runTransaction(async tx => { expect((await tx.getAll(reference))[0].exists).toBe(false) })
})

test('paths, operators, unbounded reads and readonly writes fail closed', async () => {
  await expect(facade.collection('talioDatasets').doc('other-dataset').get()).rejects.toThrow('Cross-dataset')
  expect(() => records(root, 'items').where(new FieldPath('data', 'email'), '!=', 'x')).toThrow('equality')
  await expect(records(root, 'items').get()).rejects.toThrow('explicit query limit')
  await expect(facade.runTransaction(tx => tx.set(root, {}), { readOnly: true })).rejects.toThrow('read-only')
})
