import { BSON } from 'mongodb'
import { assertMigrationWritesAllowed } from './migrationFence.cjs'
import { mongoRecordKey, mongoUniqueKey, decodeMongoRecord } from './mongoStore.server'
import { pack, unpack, recordDigest } from './firestoreCodec.cjs'

const clone = value => value == null ? value : unpack(pack(value))
const fail = message => { throw new Error(message) }
const validSegment = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(value) && !value.includes('..') && !/^__.*__$/.test(value)
const partsOf = field => {
  const parts = typeof field === 'string' ? field.split('.') : field?.segments
  if (!Array.isArray(parts) || !parts.length || parts.some(part => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part) || /^__.*__$/.test(part))) fail('Unsupported MongoDB facade field path')
  return parts
}
const fieldValue = (value, field) => partsOf(field).reduce((item, key) => item?.[key], value)
function setField(target, field, value) {
  const parts = partsOf(field)
  for (const key of parts.slice(0, -1)) target = Object.hasOwn(target, key) && target[key] && typeof target[key] === 'object' ? target[key] : (target[key] = {})
  target[parts.at(-1)] = clone(value)
}

/** A deliberately narrow bridge for the two cross-scope provisioning workflows.
 * It maps their checked paths onto the SAME native records as normal repositories;
 * it is not a second database or a general legacy query interpreter. */
export function createMongoFirestoreFacade({ db, client = db?.client, dataset }) {
  if (!db?.collection || !client?.startSession || !/^[a-z][a-z0-9-]{7,79}$/.test(dataset || '')) fail('Native MongoDB facade context is required')
  const records = db.collection('talio_records'), claims = db.collection('talio_unique_keys'), catalogs = db.collection('talio_catalogs')
  const base = ['talioDatasets', dataset]
  function descriptor(path) {
    if (path[0] !== 'talioDatasets' || path[1] !== dataset) fail('Cross-dataset facade access is not permitted')
    if (path.length === 2) return { kind: 'catalog', key: dataset, path }
    if (path[2] !== 'databases' || !/^(talio_superadmin|talio_company_[A-Za-z0-9_-]+)$/.test(path[3] || '')) fail('Unregistered database facade path')
    const databaseName = path[3]
    if (path[4] === 'uniqueKeys' && path.length === 6) return { kind: 'claim', key: mongoUniqueKey(dataset, databaseName, path[5]), databaseName, path }
    if (path[4] !== 'collections' || path[6] !== 'records' || !validSegment(path[5]) || path[5].endsWith('.chunks')) fail('Unsupported facade collection path')
    const collectionName = path[5]
    if (path.length === 7) return { kind: 'query', databaseName, collectionName, path }
    if (path.length !== 8 && !(path.length === 10 && path[8] === 'parts')) fail('Unsupported facade document path')
    return { kind: path.length === 10 ? 'part' : 'record', key: mongoRecordKey(dataset, databaseName, collectionName, path[7]), databaseName, collectionName, recordKey: path[7], partId: path[9], path }
  }
  const bank = desc => desc.kind === 'catalog' ? catalogs : desc.kind === 'claim' ? claims : records
  const filterFor = desc => desc.kind === 'catalog' ? { _id: desc.key } : desc.kind === 'claim' ? { _id: desc.key, dataset, databaseName: desc.databaseName } : { _id: desc.key, dataset, databaseName: desc.databaseName, collectionName: desc.collectionName }
  function snapshot(reference, value) {
    return Object.freeze({ ref: reference, id: reference.id, exists: value !== null && value !== undefined, data: () => clone(value), get: field => clone(fieldValue(value, field)) })
  }
  function toSnapshot(reference, document) {
    const desc = descriptor(reference._path)
    if (!document) return snapshot(reference, null)
    if (desc.kind === 'part') return snapshot(reference, document.parts?.find(part => part.id === desc.partId)?.value || null)
    if (desc.kind === 'record') return snapshot(reference, { ...document.envelope, ...(document.digest ? { digest: document.digest } : {}) })
    const { _id, dataset: ignoredDataset, databaseName: ignoredDatabase, ...value } = document
    return snapshot(reference, value)
  }
  function reference(path) {
    const result = {
      _path: path, path: path.join('/'), id: path.at(-1),
      collection(name) { if (!validSegment(name)) fail('Invalid facade collection segment'); return query([...path, name]) },
      async get() { return readReference(result) },
      async set(value, options) { return facade.runTransaction(tx => tx.set(result, value, options)) },
      async create(value) { return facade.runTransaction(tx => tx.create(result, value)) },
      async update(value) { return facade.runTransaction(tx => tx.update(result, value)) },
      async delete() { return facade.runTransaction(tx => tx.delete(result)) },
    }
    return Object.freeze(result)
  }
  function query(path, filters = [], bound = null) {
    const result = {
      _path: path, _filters: filters, _limit: bound, path: path.join('/'),
      doc(id) { if (!validSegment(id)) fail('Invalid facade document segment'); return reference([...path, id]) },
      where(field, operator, value) {
        if (operator !== '==' || value === undefined || filters.length >= 10) fail('Only bounded equality facade queries are supported')
        const parts = partsOf(field)
        if (parts[0] !== 'data') fail('Facade queries require application data fields')
        return query(path, [...filters, { path: `envelope.${parts.join('.')}`, value }], bound)
      },
      limit(limit) { if (!Number.isInteger(limit) || limit < 1 || limit > 10001) fail('Facade query requires a limit between 1 and 10001'); return query(path, filters, limit) },
      count() {
        if (!bound) fail('Facade count requires an explicit query limit')
        return Object.freeze({ _path: path, _filters: filters, _limit: bound, _count: true, async get() { return readCount(this) } })
      },
      async get() { return readQuery(result) },
    }
    return Object.freeze(result)
  }
  async function readReference(ref, options = {}, cache) {
    const desc = descriptor(ref._path), key = `${desc.kind === 'part' ? 'record' : desc.kind}/${desc.key}`
    let document
    if (cache?.has(key)) document = cache.get(key)
    else { document = await bank(desc).findOne(filterFor(desc), options); cache?.set(key, document) }
    return toSnapshot(ref, document)
  }
  function queryFilter(ref) {
    const desc = descriptor(ref._path)
    if (desc.kind !== 'query' || !ref._limit) fail('Facade collection reads require an explicit query limit')
    const filter = { dataset, databaseName: desc.databaseName, collectionName: desc.collectionName, $and: ref._filters.map(item => ({ [item.path]: { $exists: true, $eq: item.value, ...(!Array.isArray(item.value) ? { $not: { $type: 'array' } } : {}) } })) }
    if (!filter.$and.length) delete filter.$and
    return { desc, filter }
  }
  async function readCount(ref, options = {}) {
    const { filter } = queryFilter(ref)
    const count = await records.countDocuments(filter, { ...options, limit: ref._limit })
    return Object.freeze({ data: () => ({ count }) })
  }
  async function readQuery(ref, options = {}, cache) {
    const { desc, filter } = queryFilter(ref)
    const documents = await records.find(filter, options).sort({ recordKey: 1 }).limit(ref._limit).toArray()
    const docs = documents.map(document => {
      cache?.set(`record/${document._id}`, document)
      return toSnapshot(reference([...ref._path, document.recordKey]), document)
    })
    return Object.freeze({ docs, size: docs.length, empty: docs.length === 0 })
  }
  async function readMany(refs, options = {}, cache = new Map()) {
    if (refs.length > 400) fail('Facade batched reads exceed the explicit document bound')
    const groups = new Map()
    for (const ref of refs) {
      const desc = descriptor(ref._path), kind = desc.kind === 'part' ? 'record' : desc.kind
      if (kind === 'query') fail('Facade batched reads require document references')
      if (cache.has(`${kind}/${desc.key}`)) continue
      const namespace = kind === 'catalog' ? {} : { dataset, databaseName: desc.databaseName, ...(kind === 'record' ? { collectionName: desc.collectionName } : {}) }
      const groupKey = JSON.stringify([kind, namespace])
      if (!groups.has(groupKey)) groups.set(groupKey, { kind, namespace, keys: new Set() })
      groups.get(groupKey).keys.add(desc.key)
    }
    for (const { kind, namespace, keys } of groups.values()) {
      const collection = kind === 'catalog' ? catalogs : kind === 'claim' ? claims : records
      const documents = await collection.find({ _id: { $in: [...keys] }, ...namespace }, options).toArray()
      const byId = new Map(documents.map(doc => [doc._id, doc]))
      for (const key of keys) cache.set(`${kind}/${key}`, byId.get(key) || null)
    }
    return refs.map(ref => {
      const desc = descriptor(ref._path), kind = desc.kind === 'part' ? 'record' : desc.kind
      return toSnapshot(ref, cache.get(`${kind}/${desc.key}`))
    })
  }
  const facade = {
    collection(name) { if (name !== base[0]) fail('Unsupported facade root collection'); return query([name]) },
    async getAll(...refs) { return readMany(refs) },
    async runTransaction(callback, { readOnly = false } = {}) {
      const session = client.startSession()
      try {
        return await session.withTransaction(async () => {
          const cache = new Map(), staged = new Map(), options = { session }
          let queue = Promise.resolve()
          // Provisioning batches reads with Promise.all. Native Mongo sessions
          // disallow parallel operations, so serialize transport inside this API.
          const serialized = callback => { const result = queue.then(callback); queue = result.catch(() => {}); return result }
          function stage(ref, operation, value, merge = false) {
            if (readOnly) fail('Writes are not permitted in a read-only transaction')
            const desc = descriptor(ref._path)
            if (desc.kind === 'query') fail('Cannot write a query')
            if (operation !== 'delete' && (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) fail('Facade writes require a plain record')
            staged.set(ref.path, { ref, desc, operation, value: clone(value), merge })
            if (staged.size > 450) fail('Facade transaction exceeds the bounded write budget')
          }
          const tx = Object.freeze({
            get(ref) { return serialized(() => ref._count ? readCount(ref, options) : ref._filters ? readQuery(ref, options, cache) : readReference(ref, options, cache)) },
            getAll(...refs) { return serialized(() => readMany(refs, options, cache)) },
            create(ref, value) { stage(ref, 'create', value); return tx },
            set(ref, value, config = {}) { stage(ref, 'set', value, config.merge === true); return tx },
            update(ref, value) { stage(ref, 'update', value); return tx },
            delete(ref) { stage(ref, 'delete'); return tx },
          })
          const result = await callback(tx)
          await queue
          if (staged.size) assertMigrationWritesAllowed()
          // Many direct workflows stage new records/claims without pre-reading
          // each one. Fetch uncached parents once per namespace, not one round-trip
          // per staged document; synthetic parts share their parent's bundle.
          const unread = new Map()
          for (const item of staged.values()) {
            const kind = item.desc.kind === 'part' ? 'record' : item.desc.kind
            const key = `${kind}/${item.desc.key}`
            if (!cache.has(key) && !unread.has(key)) unread.set(key, reference(item.desc.kind === 'part' ? item.desc.path.slice(0, 8) : item.desc.path))
          }
          const references = [...unread.values()]
          for (let offset = 0; offset < references.length; offset += 400) await readMany(references.slice(offset, offset + 400), options, cache)
          const changes = new Map()
          for (const item of staged.values()) {
            const kind = item.desc.kind === 'part' ? 'record' : item.desc.kind, cacheKey = `${kind}/${item.desc.key}`
            if (!changes.has(cacheKey)) {
              changes.set(cacheKey, { desc: { ...item.desc, kind }, original: cache.get(cacheKey), document: clone(cache.get(cacheKey)), create: false })
            }
            const change = changes.get(cacheKey), current = change.document
            if (item.desc.kind === 'part') {
              if (!current && item.operation === 'delete') continue
              if (!current) fail('Facade overflow part requires an existing or staged parent record')
              const parts = (current.parts || []).filter(part => part.id !== item.desc.partId)
              if (item.operation !== 'delete') parts.push({ id: item.desc.partId, value: item.value })
              current.parts = parts
              continue
            }
            if (item.operation === 'delete') { change.document = null; continue }
            if (item.operation === 'create' && current) throw Object.assign(new Error('Record already exists'), { code: 'ALREADY_EXISTS' })
            if (item.operation === 'update' && !current) throw Object.assign(new Error('Record not found'), { code: 'NOT_FOUND' })
            if (item.operation === 'create') change.create = true
            const existing = kind === 'record' ? current?.envelope : current
            const data = item.operation === 'update' || item.merge ? clone(existing || {}) : clone(item.value)
            if (item.operation === 'update') for (const [field, value] of Object.entries(item.value)) setField(data, field, value)
            else if (item.merge) Object.assign(data, item.value)
            if (kind === 'record') {
              const metadata = Object.fromEntries(['media', 'mediaState'].filter(key => current?.envelope?.[key] !== undefined).map(key => [key, current.envelope[key]]))
              change.document = { _id: item.desc.key, dataset, databaseName: item.desc.databaseName, collectionName: item.desc.collectionName, recordKey: item.desc.recordKey, envelope: { ...data, ...metadata }, parts: current?.parts || [] }
            } else change.document = { ...data, _id: item.desc.key, ...(kind === 'claim' ? { dataset, databaseName: item.desc.databaseName } : {}) }
          }
          const batches = new Map()
          for (const change of changes.values()) {
            if (change.document && change.desc.kind === 'record') change.document.digest = recordDigest(decodeMongoRecord(change.document))
            if (change.document && BSON.calculateObjectSize(change.document) > 15 * 1024 * 1024) fail('Facade record exceeds MongoDB document size')
            const name = change.desc.kind === 'catalog' ? 'talio_catalogs' : change.desc.kind === 'claim' ? 'talio_unique_keys' : 'talio_records'
            if (!batches.has(name)) batches.set(name, [])
            batches.get(name).push(!change.document ? { deleteOne: { filter: filterFor(change.desc) } } : change.create ? { insertOne: { document: change.document } } : { replaceOne: { filter: filterFor(change.desc), replacement: change.document, upsert: true } })
          }
          if (staged.size) assertMigrationWritesAllowed()
          for (const [name, operations] of batches) if (operations.length) await db.collection(name).bulkWrite(operations, options)
          return result
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' })
      } catch (error) {
        if (error?.code === 11000) throw Object.assign(new Error('Record already exists'), { code: 'ALREADY_EXISTS' })
        throw error
      } finally { await session.endSession() }
    },
  }
  return Object.freeze(facade)
}
