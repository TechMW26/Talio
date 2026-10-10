import { createHash } from 'node:crypto'
import { BSON } from 'mongodb'
import { assertMigrationWritesAllowed } from './migrationFence.cjs'
import { encodeApplicationRecord, decodeApplicationRecord, applicationRecordKey, recordDigest, pack, unpack } from './firestoreCodec.cjs'
import { projectNativeRecord, SEARCH_GRAM_OVERFLOW_SENTINEL } from './searchProjection.cjs'
import { MAX_MONGO_MEMBERSHIP_VALUES } from './mongoQueryPolicy.cjs'

export const MONGO_RECORD_COLLECTION = 'talio_records'
export const MONGO_CLAIM_COLLECTION = 'talio_unique_keys'
const hash = value => createHash('sha256').update(value).digest('hex')
const clone = value => value === null ? null : unpack(pack(value))
const badQuery = message => Object.assign(new TypeError(message), { status: 400 })
const conflict = () => Object.assign(new Error('Unique field is already in use'), { code: 'ALREADY_EXISTS' })
const OPS = { '==': '$eq', '!=': '$ne', '<': '$lt', '<=': '$lte', '>': '$gt', '>=': '$gte', in: '$in', 'not-in': '$nin', 'array-contains': '$eq', 'array-contains-any': '$in' }

function segment(value, label, expression = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/) {
  if (typeof value !== 'string' || !expression.test(value) || value.includes('..') || /^__.*__$/.test(value)) throw new TypeError(`Invalid ${label}`)
  return value
}
function fieldPath(value) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value) || value.split('.').some(part => /^__.*__$/.test(part))) throw badQuery('Invalid query field')
  return `envelope.data.${value}`
}
function validateQuery({ filters = [], orderBy = [], limit = 50 } = {}, maximumLimit = 100) {
  if (!Array.isArray(filters) || filters.length > 10 || !Array.isArray(orderBy) || orderBy.length > 3) throw badQuery('Query is too complex')
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumLimit) throw badQuery(`Page limit must be between 1 and ${maximumLimit}`)
  for (const filter of filters) {
    fieldPath(filter.field)
    if (!Object.hasOwn(OPS, filter.operator) || filter.value === undefined) throw badQuery('Unsupported database filter')
    if (['in', 'not-in', 'array-contains-any'].includes(filter.operator) && (!Array.isArray(filter.value) || !filter.value.length || filter.value.length > MAX_MONGO_MEMBERSHIP_VALUES)) throw badQuery('Invalid membership filter')
  }
  for (const order of orderBy) {
    fieldPath(order.field)
    if (order.direction && !['asc', 'desc'].includes(order.direction)) throw badQuery('Invalid sort direction')
  }
  if (new Set(orderBy.map(order => order.field)).size !== orderBy.length) throw badQuery('Duplicate query sort field')
  filters = filters.map(filter => filter.field === 'searchGrams' && filter.operator === 'array-contains'
    ? { ...filter, operator: 'array-contains-any', value: [...new Set([filter.value, SEARCH_GRAM_OVERFLOW_SENTINEL])] } : filter)
  const implicit = [...new Set(filters.filter(filter => ['!=', '<', '<=', '>', '>=', 'not-in'].includes(filter.operator)).map(filter => filter.field))]
  const completeOrder = orderBy.length ? [...orderBy, ...implicit.filter(field => !orderBy.some(order => order.field === field)).sort().map(field => ({ field, direction: orderBy.at(-1).direction || 'asc' }))] : implicit.map(field => ({ field, direction: 'asc' }))
  return { filters, orderBy: completeOrder, limit }
}

export function mongoRecordId(dataset, databaseName, collectionName, id) {
  return mongoRecordKey(dataset, databaseName, collectionName, applicationRecordKey(id))
}
export function mongoRecordKey(dataset, databaseName, collectionName, recordKey) {
  return hash(JSON.stringify([dataset, databaseName, collectionName, recordKey]))
}
export function mongoUniqueKey(dataset, databaseName, firestoreClaimKey) {
  return hash(JSON.stringify([dataset, databaseName, firestoreClaimKey]))
}

/** One BSON document contains each record and its compressed overflow fields.
 * This retains the existing lossless value codec without duplicate raw copies
 * or multipart read round-trips. Media descriptors are immutable metadata. */
export function encodeMongoRecord({ dataset, databaseName, collectionName, record, envelopeMetadata = {} }) {
  const encoded = encodeApplicationRecord(record)
  const document = {
    _id: mongoRecordId(dataset, databaseName, collectionName, record._id),
    dataset, databaseName, collectionName, recordKey: applicationRecordKey(record._id),
    envelope: { ...encoded.envelope, ...envelopeMetadata }, parts: encoded.parts, digest: recordDigest(record),
  }
  // The reused codec bounds compressed overflow to 7 MiB. Also check BSON so
  // no import or future codec change can accidentally exceed MongoDB's limit.
  if (BSON.calculateObjectSize(document) > 15 * 1024 * 1024) throw new Error('Application record exceeds MongoDB document size; extract media first')
  return document
}
export function decodeMongoRecord(document) {
  if (!document) return null
  const parts = new Map((document.parts || []).map(part => {
    const value = part.value.bytes
    const bytes = Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : typeof value?.value === 'function' ? Buffer.from(value.value(true)) : Buffer.from(value)
    return [part.id, { ...part.value, bytes }]
  }))
  return decodeApplicationRecord(document.envelope, parts)
}

/** Trusted server-only tenant repository; never accept databaseName from query parameters. */
export function createMongoDatabase({ mongo, db = mongo, client = db?.client, dataset, databaseName, scope = 'tenant', constraints = {}, queryFields = {} }) {
  if (typeof dataset !== 'string' || !/^[a-z][a-z0-9-]{7,79}$/.test(dataset)) throw new TypeError('Explicit application dataset is required')
  segment(databaseName, 'database name', /^[A-Za-z][A-Za-z0-9_-]{0,62}$/)
  if (scope === 'tenant' && !/^talio_company_[A-Za-z0-9_-]+$/.test(databaseName)) throw new Error('A registered tenant database is required')
  if (scope === 'system' && databaseName !== 'talio_superadmin') throw new Error('Invalid system database')
  if (!['tenant', 'system', 'migration'].includes(scope)) throw new Error('Invalid database scope')
  if (!db?.collection || !client?.startSession) throw new TypeError('Native MongoDB database and client are required')
  const records = db.collection(MONGO_RECORD_COLLECTION), unique = db.collection(MONGO_CLAIM_COLLECTION)
  const namespace = name => {
    segment(name, 'collection')
    if (name.endsWith('.chunks')) throw new Error('Binary media belongs in Vercel Blob')
    return { dataset, databaseName, collectionName: name }
  }
  const identity = (name, id) => ({ ...namespace(name), _id: mongoRecordId(dataset, databaseName, name, id) })
  function queryFor(name, definition) {
    const filters = [namespace(name)]
    for (const { field } of [...definition.filters, ...definition.orderBy]) if (!queryFields[name]?.includes(field)) throw new Error(`Query field requires an explicit indexed schema: ${name}.${field}`)
    for (const { field, operator, value } of definition.filters) {
      const path = fieldPath(field)
      const condition = { $exists: true, [OPS[operator]]: value }
      // Firestore exclusions never match absent/null values; MongoDB otherwise does.
      if (['!=', 'not-in'].includes(operator)) filters.push({ [path]: { $ne: null } })
      if (['array-contains', 'array-contains-any'].includes(operator)) condition.$type = 'array'
      // MongoDB equality/membership automatically searches array elements;
      // Firestore scalar equality does not. Retain exact repository semantics.
      if (operator === '==' && !Array.isArray(value) || operator === 'in' && value.every(item => !Array.isArray(item))) condition.$not = { $type: 'array' }
      if (['!=', 'not-in'].includes(operator)) {
        delete condition[OPS[operator]]
        // Expressions compare the entire value rather than implicitly matching
        // array elements, which matters for exclusions of scalar values.
        filters.push({ $expr: operator === '!=' ? { $ne: [`$${path}`, { $literal: value }] } : { $not: [{ $in: [`$${path}`, { $literal: value }] }] } })
      }
      filters.push({ [path]: condition })
    }
    for (const order of definition.orderBy) filters.push({ [fieldPath(order.field)]: { $exists: true } })
    return { $and: filters }
  }
  const sortFor = definition => Object.fromEntries([...definition.orderBy.map(order => [fieldPath(order.field), order.direction === 'desc' ? -1 : 1]), ['recordKey', 1]])
  function claimList(name, record) {
    if (!record) return []
    return (constraints[name] || []).flatMap(({ fields, sparse = false }) => {
      if (!Array.isArray(fields) || !fields.length) throw new Error('Invalid unique constraint definition')
      const values = fields.map(field => { fieldPath(field); return field.split('.').reduce((value, key) => value?.[key], record) })
      if (sparse && values.some(value => value === null || value === undefined || value === '')) return []
      if (values.some(value => value == null)) throw new Error('Required unique field is missing')
      if (values.some(value => !['string', 'boolean', 'number'].includes(typeof value))) throw new Error('Unique keys must be scalar values')
      return [{ _id: mongoUniqueKey(dataset, databaseName, hash(JSON.stringify([name, fields, values]))), owner: `${name}/${record._id}`, name, fields, values }]
    })
  }
  const store = {
    databaseName,
    async get(name, id) { return decodeMongoRecord(await records.findOne(identity(name, id))) },
    async getMany(name, ids) {
      if (!Array.isArray(ids) || ids.length > 100) throw new TypeError('Read at most 100 IDs per request')
      if (!ids.length) return []
      const keys = ids.map(id => identity(name, id)._id)
      const documents = await records.find({ ...namespace(name), _id: { $in: keys } }).toArray()
      const byId = new Map(documents.map(doc => [doc._id, doc]))
      return keys.map(key => decodeMongoRecord(byId.get(key)))
    },
    async list(name, options = {}) {
      const definition = validateQuery(options), filter = queryFor(name, definition)
      const fingerprint = hash(JSON.stringify([dataset, databaseName, name, definition]))
      if (options.cursor) {
        if (typeof options.cursor !== 'string' || options.cursor.length > 16384) throw badQuery('Invalid page cursor')
        let cursor
        try { cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')) } catch { throw badQuery('Invalid page cursor') }
        if (cursor.version !== 2 || cursor.query !== fingerprint) throw badQuery('Page cursor does not match this tenant/query')
        segment(cursor.id, 'cursor ID')
        const values = unpack(cursor.values)
        if (!Array.isArray(values) || values.length !== definition.orderBy.length) throw badQuery('Invalid page cursor values')
        const keys = [...definition.orderBy.map(order => fieldPath(order.field)), 'recordKey'], anchors = [...values, cursor.id]
        filter.$and.push({ $or: keys.map((key, index) => {
          const operator = index < definition.orderBy.length && definition.orderBy[index].direction === 'desc' ? '$lt' : '$gt'
          // Query comparisons type-bracket values: `$gt: null` cannot advance
          // to a date, and `$lt: date` cannot reach null. Expressions use the
          // same BSON ordering as sort in both pagination directions.
          const comparison = ['$expr', { [operator]: [`$${key}`, { $literal: anchors[index] }] }]
          return Object.fromEntries([...keys.slice(0, index).map((previous, offset) => [previous, anchors[offset]]), comparison])
        }) })
      }
      const documents = await records.find(filter).sort(sortFor(definition)).limit(definition.limit + 1).toArray()
      const page = documents.slice(0, definition.limit), last = page.at(-1)
      return {
        records: page.map(decodeMongoRecord),
        nextCursor: documents.length > definition.limit ? Buffer.from(JSON.stringify({ version: 2, query: fingerprint, id: last.recordKey, values: pack(definition.orderBy.map(order => order.field.split('.').reduce((value, key) => value?.[key], last.envelope.data))) })).toString('base64url') : null,
      }
    },
    async count(name, filters = []) { return records.countDocuments(queryFor(name, validateQuery({ filters }))) },
    /** Callback can be retried by MongoDB: keep external effects outside it. */
    async transaction(callback, { maxWrites = 50 } = {}) {
      if (!Number.isInteger(maxWrites) || maxWrites < 1 || maxWrites > 400) throw new TypeError('Transaction record bound must be between 1 and 400')
      const session = client.startSession()
      try {
        return await session.withTransaction(async () => {
          const reads = new Map(), writes = new Map(), nativeOptions = { session }
          let readQueue = Promise.resolve()
          const nativeRead = callback => { const result = readQueue.then(callback); readQueue = result.catch(() => {}); return result }
          async function load(name, id) {
            const filter = identity(name, id), key = filter._id
            if (!reads.has(key)) await nativeRead(async () => {
              if (reads.has(key)) return
              const document = await records.findOne(filter, nativeOptions)
              reads.set(key, { document, record: decodeMongoRecord(document) })
            })
            return { key, ...reads.get(key) }
          }
          const tx = Object.freeze({
            async get(name, id) { const loaded = await load(name, id); return clone(writes.has(loaded.key) ? writes.get(loaded.key).record : loaded.record) },
            async getMany(name, ids) {
              if (!Array.isArray(ids)) throw new TypeError('Record IDs must be an array')
              const list = [...new Set(ids.map(String))]
              await nativeRead(async () => {
                const missing = list.map(id => identity(name, id)._id).filter(key => !reads.has(key))
                if (!missing.length) return
                const documents = await records.find({ ...namespace(name), _id: { $in: missing } }, nativeOptions).toArray()
                const byKey = new Map(documents.map(doc => [doc._id, doc]))
                for (const key of missing) { const document = byKey.get(key) || null; reads.set(key, { document, record: decodeMongoRecord(document) }) }
              })
              return list.map(id => { const key = identity(name, id)._id; return clone(writes.has(key) ? writes.get(key).record : reads.get(key).record) })
            },
            async list(name, options = {}) {
              if (writes.size) throw new Error('Run transaction queries before staging writes')
              if (options.cursor) throw badQuery('Transaction queries do not accept page cursors')
              const definition = validateQuery(options, options.requireComplete === true ? 1000 : 100)
              const documents = await nativeRead(() => records.find(queryFor(name, definition), nativeOptions).sort(sortFor(definition)).limit(definition.limit + 1).toArray())
              const hasMore = documents.length > definition.limit
              if (hasMore && options.requireComplete) throw new Error('Transaction query exceeds its explicit result bound')
              return { hasMore, records: documents.slice(0, definition.limit).map(document => { const record = decodeMongoRecord(document); reads.set(document._id, { document, record }); return clone(record) }) }
            },
            async create(name, record) {
              const loaded = await load(name, record?._id)
              if (loaded.record || writes.has(loaded.key)) throw Object.assign(new Error('Record already exists'), { code: 'ALREADY_EXISTS' })
              writes.set(loaded.key, { ...loaded, name, original: loaded.record, record: clone(projectNativeRecord(name, record)) })
            },
            async replace(name, record) {
              const loaded = await load(name, record?._id)
              if (!loaded.record && !writes.has(loaded.key)) throw Object.assign(new Error('Record not found'), { code: 'NOT_FOUND' })
              writes.set(loaded.key, { ...loaded, name, original: loaded.record, record: clone(projectNativeRecord(name, record)) })
            },
            async delete(name, id) { const loaded = await load(name, id); writes.set(loaded.key, { ...loaded, name, original: loaded.record, record: null }) },
          })
          const result = await callback(tx)
          await readQueue
          if (writes.size) assertMigrationWritesAllowed()
          if (writes.size > maxWrites) throw new Error(`Use bounded transactions of at most ${maxWrites} records`)
          const oldClaims = new Map(), nextClaims = new Map()
          for (const write of writes.values()) {
            for (const claim of claimList(write.name, write.original)) oldClaims.set(claim._id, claim)
            for (const claim of claimList(write.name, write.record)) {
              if (nextClaims.has(claim._id) && nextClaims.get(claim._id).owner !== claim.owner) throw conflict()
              nextClaims.set(claim._id, claim)
            }
          }
          const claimIds = [...new Set([...oldClaims.keys(), ...nextClaims.keys()])]
          const existingClaims = claimIds.length ? await unique.find({ _id: { $in: claimIds }, dataset, databaseName }, nativeOptions).toArray() : []
          const byClaim = new Map(existingClaims.map(claim => [claim._id, claim]))
          for (const id of claimIds) {
            const desired = nextClaims.get(id), existing = byClaim.get(id)
            if (desired && existing && existing.owner !== desired.owner && oldClaims.get(id)?.owner !== existing.owner) throw conflict()
            if (!desired && existing && oldClaims.get(id)?.owner !== existing.owner) throw new Error('Unique field ownership mismatch')
            if (desired && !existing) {
              const filter = { ...namespace(desired.name), ...Object.fromEntries(desired.fields.map((field, index) => [fieldPath(field), desired.values[index]])) }
              // Ownership is the only field used here. Avoid transferring and
              // hydrating potentially large imported overflow/media bundles.
              const matches = await records.find(filter, { ...nativeOptions, projection: { 'envelope.data._id': 1 } }).limit(2).toArray()
              for (const match of matches) {
                const owner = `${desired.name}/${match.envelope.data._id}`
                if (owner !== desired.owner && oldClaims.get(id)?.owner !== owner) throw conflict()
              }
            }
          }
          if (writes.size) assertMigrationWritesAllowed()
          if (writes.size) await records.bulkWrite([...writes.values()].map(write => {
            if (!write.record) return { deleteOne: { filter: { ...namespace(write.name), _id: write.key } } }
            const metadata = Object.fromEntries(['media', 'mediaState'].filter(key => write.document?.envelope?.[key] !== undefined).map(key => [key, write.document.envelope[key]]))
            return { replaceOne: { filter: { ...namespace(write.name), _id: write.key }, replacement: encodeMongoRecord({ dataset, databaseName, collectionName: write.name, record: write.record, envelopeMetadata: metadata }), upsert: true } }
          }), nativeOptions)
          if (claimIds.length) await unique.bulkWrite(claimIds.map(id => nextClaims.has(id)
            ? { replaceOne: { filter: { _id: id }, replacement: { _id: id, dataset, databaseName, owner: nextClaims.get(id).owner }, upsert: true } }
            : { deleteOne: { filter: { _id: id, dataset, databaseName } } }), nativeOptions)
          return result
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' })
      } catch (error) {
        if (error?.code === 11000) throw conflict()
        throw error
      } finally { await session.endSession() }
    },
    async create(name, record) { await store.transaction(tx => tx.create(name, record)); return record },
    async mutate(name, id, callback) {
      return store.transaction(async tx => {
        const current = await tx.get(name, id)
        if (!current) return null
        const next = await callback(current)
        if (!next || next._id !== id) throw new Error('Mutation must preserve the record ID')
        await tx.replace(name, next)
        return next
      })
    },
    async delete(name, id) { await store.transaction(tx => tx.delete(name, id)) },
  }
  return Object.freeze(store)
}
