import { createHash } from 'node:crypto'
import { FieldPath } from 'firebase-admin/firestore'
import { getTalioFirestore } from './firestore.server'
import { encodeApplicationRecord, decodeApplicationRecord, partIds, recordDigest, applicationRecordKey, pack, unpack } from './firestoreCodec.cjs'
import { projectNativeRecord, SEARCH_GRAM_OVERFLOW_SENTINEL } from './searchProjection.cjs'

const OPERATORS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains', 'array-contains-any'])
const hash = value => createHash('sha256').update(value).digest('hex')
const clone = value => value === null ? null : unpack(pack(value))
const queryInputError = message => Object.assign(new TypeError(message), { status: 400 })
function normalizeSearchFilters(filters) {
  return filters.map(filter => filter.field === 'searchGrams' && filter.operator === 'array-contains'
    ? { ...filter, operator: 'array-contains-any', value: [...new Set([filter.value, SEARCH_GRAM_OVERFLOW_SENTINEL])] }
    : filter)
}

/** Safe batch for one prospective IN/array-any filter in a nested collection. */
export function getFirestoreMembershipBatchSize(extraFilters = [], orderBy = []) {
  extraFilters = normalizeSearchFilters(extraFilters)
  const alternatives = extraFilters.filter(filter => ['in', 'array-contains-any'].includes(filter.operator)).reduce((size, filter) => size * filter.value.length, 1)
  const orderFields = new Set([...orderBy.map(order => order.field), ...extraFilters.filter(filter => ['!=', '<', '<=', '>', '>=', 'not-in'].includes(filter.operator)).map(filter => filter.field)])
  const componentsPerBranch = extraFilters.length + 1 + orderFields.size + 2
  const size = Math.min(30, Math.floor(30 / alternatives), Math.floor(100 / (alternatives * componentsPerBranch)))
  if (size < 1) throw queryInputError('Firestore query cannot fit a membership batch; simplify its filters')
  return size
}

export function assertFirestoreDataset(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{7,79}$/.test(value)) throw new TypeError('Explicit FIRESTORE_DATASET is required')
  return value
}

function assertSegment(value, label, expression = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/) {
  if (typeof value !== 'string' || !expression.test(value) || value.includes('..') || /^__.*__$/.test(value)) throw new TypeError(`Invalid ${label}`)
  return value
}

function fieldPath(value) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value) || value.split('.').some(part => /^__.*__$/.test(part))) throw queryInputError('Invalid query field')
  return new FieldPath('data', ...value.split('.'))
}

function validateQuery({ filters = [], orderBy = [], limit = 50 } = {}, maximumLimit = 100) {
  if (!Array.isArray(filters) || filters.length > 10 || !Array.isArray(orderBy) || orderBy.length > 3) throw queryInputError('Query is too complex')
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumLimit) throw queryInputError(`Page limit must be between 1 and ${maximumLimit}`)
  for (const filter of filters) {
    fieldPath(filter.field)
    if (!OPERATORS.has(filter.operator) || filter.value === undefined) throw queryInputError('Unsupported Firestore filter')
    if (['in', 'not-in', 'array-contains-any'].includes(filter.operator) && (!Array.isArray(filter.value) || !filter.value.length || filter.value.length > (filter.operator === 'not-in' ? 10 : 30))) throw queryInputError('Invalid membership filter')
  }
  for (const order of orderBy) {
    fieldPath(order.field)
    if (order.direction && !['asc', 'desc'].includes(order.direction)) throw queryInputError('Invalid sort direction')
  }
  filters = normalizeSearchFilters(filters)
  if (filters.filter(filter => ['array-contains', 'array-contains-any'].includes(filter.operator)).length > 1) throw queryInputError('Firestore permits only one array membership filter per query')
  if (filters.filter(filter => ['!=', 'not-in'].includes(filter.operator)).length > 1) throw queryInputError('Firestore permits only one exclusion filter per query')
  if (filters.some(filter => filter.operator === 'not-in') && filters.some(filter => ['in', 'array-contains-any'].includes(filter.operator))) throw queryInputError('Firestore not-in cannot be combined with membership disjunctions')
  const disjunctions = filters.filter(filter => ['in', 'array-contains-any'].includes(filter.operator)).reduce((size, filter) => size * filter.value.length, 1)
  if (disjunctions > 30) throw queryInputError('Firestore supports at most 30 membership disjunctions; split the query explicitly')
  if (new Set(orderBy.map(order => order.field)).size !== orderBy.length) throw queryInputError('Duplicate query sort field')
  // Native range queries require their inequality ordering before the stable
  // document-ID tie breaker. Keep the caller's order, then append any remaining
  // inequality fields just as Firestore does. All sort values must be in our
  // cursor; allowing the SDK to append them after __name__ breaks pagination.
  const implicitOrder = [...new Set(filters.filter(filter => ['!=', '<', '<=', '>', '>=', 'not-in'].includes(filter.operator)).map(filter => filter.field))]
  const completeOrder = orderBy.length ? [...orderBy, ...implicitOrder.filter(field => !orderBy.some(order => order.field === field)).sort().map(field => ({ field, direction: orderBy.at(-1).direction || 'asc' }))] : implicitOrder.map(field => ({ field, direction: 'asc' }))
  // Conservatively reserve the complete sort/path budget in every DNF branch,
  // including our document-ID order and the enclosing subcollection path.
  // Membership callers batch with getFirestoreMembershipBatchSize above.
  if (disjunctions * (filters.length + completeOrder.length + 2) > 100) throw queryInputError('Firestore query exceeds the 100-component filter budget; split the query explicitly')
  return { filters, orderBy: completeOrder, limit }
}

/**
 * Native Firestore operations. This is NOT an interpreter for legacy queries.
 * Callers explicitly supply Firestore filters and cursor pagination; unsupported
 * operators/indexes fail rather than falling back to collection scans.
 * databaseName must come from a trusted registry/JWT, not a query parameter.
 * Domain repositories own field validation, role checks, hooks and constraints.
 */
export function createFirestoreDatabase({ firestore, dataset, databaseName, scope = 'tenant', constraints = {}, queryFields = {} }) {
  assertFirestoreDataset(dataset)
  assertSegment(databaseName, 'database name', /^[A-Za-z][A-Za-z0-9_-]{0,62}$/)
  if (scope === 'tenant' && !/^talio_company_[A-Za-z0-9_-]+$/.test(databaseName)) throw new Error('A registered tenant database is required')
  if (scope === 'system' && databaseName !== 'talio_superadmin') throw new Error('Invalid system database')
  if (!['tenant', 'system', 'migration'].includes(scope)) throw new Error('Invalid Firestore scope')
  const root = firestore.collection('talioDatasets').doc(dataset).collection('databases').doc(databaseName)
  const collection = name => {
    assertSegment(name, 'collection')
    if (name.endsWith('.chunks')) throw new Error('Binary media belongs in Vercel Blob')
    return root.collection('collections').doc(name).collection('records')
  }
  const ref = (name, id) => collection(name).doc(applicationRecordKey(id))

  async function hydrate(snapshot, reader = firestore) {
    if (!snapshot.exists) return null
    const envelope = snapshot.data(), ids = partIds(envelope)
    const parts = ids.length ? await reader.getAll(...ids.map(id => snapshot.ref.collection('parts').doc(id))) : []
    return decodeApplicationRecord(envelope, new Map(parts.filter(p => p.exists).map(p => [p.id, p.data()])))
  }

  function queryFor(name, { filters, orderBy }) {
    let query = collection(name)
    for (const { field } of [...filters, ...orderBy]) {
      if (!queryFields[name]?.includes(field)) throw new Error(`Query field requires an explicit indexed schema: ${name}.${field}`)
    }
    for (const { field, operator, value } of filters) query = query.where(fieldPath(field), operator, value)
    for (const { field, direction = 'asc' } of orderBy) query = query.orderBy(fieldPath(field), direction)
    return query
  }

  function claims(name, record) {
    if (!record) return []
    return (constraints[name] || []).flatMap(({ fields, sparse = false }) => {
      if (!Array.isArray(fields) || !fields.length) throw new Error('Invalid unique constraint definition')
      const values = fields.map(field => {
        fieldPath(field)
        return field.split('.').reduce((value, key) => value?.[key], record)
      })
      if (sparse && values.some(value => value === null || value === undefined || value === '')) return []
      if (values.some(value => value === undefined || value === null)) throw new Error('Required unique field is missing')
      if (values.some(value => !['string', 'boolean', 'number'].includes(typeof value))) throw new Error('Unique keys must be scalar values')
      return [{ key: hash(JSON.stringify([name, fields, values])), owner: `${name}/${record._id}`, name, fields, values }]
    })
  }

  const store = {
    databaseName,
    async get(name, id) { return firestore.runTransaction(async tx => hydrate(await tx.get(ref(name, id)), tx), { readOnly: true }) },
    async getMany(name, ids) {
      if (!Array.isArray(ids) || ids.length > 100) throw new TypeError('Read at most 100 IDs per request')
      if (!ids.length) return []
      return firestore.runTransaction(async tx => {
        const snapshots = await tx.getAll(...ids.map(id => ref(name, id)))
        return Promise.all(snapshots.map(snapshot => hydrate(snapshot, tx)))
      }, { readOnly: true })
    },
    async list(name, options = {}) {
      const definition = validateQuery(options)
      const fingerprint = hash(JSON.stringify([dataset, databaseName, name, definition]))
      let query = queryFor(name, definition).orderBy(FieldPath.documentId(), 'asc')
      if (options.cursor) {
        if (typeof options.cursor !== 'string' || options.cursor.length > 16384) throw queryInputError('Invalid page cursor')
        let cursor
        try { cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')) } catch { throw queryInputError('Invalid page cursor') }
        if (cursor.version !== 2 || cursor.query !== fingerprint) throw queryInputError('Page cursor does not match this tenant/query')
        const anchorId = assertSegment(cursor.id, 'cursor ID')
        const values = unpack(cursor.values)
        if (!Array.isArray(values) || values.length !== definition.orderBy.length) throw queryInputError('Invalid page cursor values')
        // Snapshot values survive deletion of the last item on a page. This is
        // essential for paginated retention jobs and bulk administration.
        query = query.startAfter(...values, anchorId)
      }
      return firestore.runTransaction(async tx => {
        const snapshot = await tx.get(query.limit(definition.limit + 1))
        const docs = snapshot.docs.slice(0, definition.limit)
        const last = docs.at(-1)
        return {
          records: await Promise.all(docs.map(doc => hydrate(doc, tx))),
          nextCursor: snapshot.docs.length > definition.limit ? Buffer.from(JSON.stringify({ version: 2, query: fingerprint, id: last.id, values: pack(definition.orderBy.map(order => {
            const value = last.get(fieldPath(order.field))
            return value?.toDate instanceof Function ? value.toDate() : value
          })) })).toString('base64url') : null,
        }
      }, { readOnly: true })
    },
    async count(name, filters = []) {
      const definition = validateQuery({ filters })
      return (await queryFor(name, definition).count().get()).data().count
    },
    /** Callback may be retried: never send notifications/upload files inside it. */
    async transaction(callback, { maxWrites = 50 } = {}) {
      if (!Number.isInteger(maxWrites) || maxWrites < 1 || maxWrites > 400) throw new TypeError('Transaction record bound must be between 1 and 400')
      return firestore.runTransaction(async native => {
        const reads = new Map(), writes = new Map()
        async function load(name, id) {
          const reference = ref(name, id), key = reference.path
          if (!reads.has(key)) {
            const snapshot = await native.get(reference)
            reads.set(key, { ref: reference, envelope: snapshot.exists ? snapshot.data() : null, record: await hydrate(snapshot, native) })
          }
          return reads.get(key)
        }
        const tx = Object.freeze({
          async list(name, options = {}) {
            // Queries must precede staged mutations: a Firestore query cannot
            // observe writes buffered by this transaction wrapper.
            if (writes.size) throw new Error('Run transaction queries before staging writes')
            if (options.cursor) throw queryInputError('Transaction queries do not accept page cursors')
            const definition = validateQuery(options, options.requireComplete === true ? 1000 : 100)
            const query = queryFor(name, definition).orderBy(FieldPath.documentId(), 'asc')
            const snapshot = await native.get(query.limit(definition.limit + 1))
            const hasMore = snapshot.docs.length > definition.limit
            if (hasMore && options.requireComplete) throw new Error('Transaction query exceeds its explicit result bound')
            const records = await Promise.all(snapshot.docs.slice(0, definition.limit).map(async doc => {
              const record = await hydrate(doc, native)
              reads.set(doc.ref.path, { ref: doc.ref, envelope: doc.data(), record })
              return clone(record)
            }))
            return { records, hasMore }
          },
          async get(name, id) {
            const loaded = await load(name, id)
            return clone(writes.has(loaded.ref.path) ? writes.get(loaded.ref.path).record : loaded.record)
          },
          /** Batched read: one getAll round-trip instead of one per ID. */
          async getMany(name, ids) {
            const list = [...new Set(ids.map(String))]
            const missing = list.map(id => ref(name, id)).filter(reference => !reads.has(reference.path))
            if (missing.length) {
              const snapshots = await native.getAll(...missing)
              await Promise.all(snapshots.map(async snapshot => {
                reads.set(snapshot.ref.path, { ref: snapshot.ref, envelope: snapshot.exists ? snapshot.data() : null, record: await hydrate(snapshot, native) })
              }))
            }
            return list.map(id => {
              const loaded = reads.get(ref(name, id).path)
              return loaded ? clone(writes.has(loaded.ref.path) ? writes.get(loaded.ref.path).record : loaded.record) : null
            })
          },
          async create(name, record) {
            const loaded = await load(name, record?._id)
            if (loaded.record || writes.has(loaded.ref.path)) throw Object.assign(new Error('Record already exists'), { code: 'ALREADY_EXISTS' })
            writes.set(loaded.ref.path, { name, ...loaded, record: clone(projectNativeRecord(name, record)) })
          },
          async replace(name, record) {
            const loaded = await load(name, record?._id)
            if (!loaded.record && !writes.has(loaded.ref.path)) throw Object.assign(new Error('Record not found'), { code: 'NOT_FOUND' })
            writes.set(loaded.ref.path, { name, ...loaded, record: clone(projectNativeRecord(name, record)) })
          },
          async delete(name, id) {
            const loaded = await load(name, id)
            writes.set(loaded.ref.path, { name, ...loaded, record: null })
          },
        })
        const result = await callback(tx)
        if (writes.size > maxWrites) throw new Error(`Use bounded transactions of at most ${maxWrites} records`)
        const oldClaims = new Map(), newClaims = new Map(), pending = []
        let writeBytes = 0, writeCount = 0
        for (const write of writes.values()) {
          for (const claim of claims(write.name, reads.get(write.ref.path).record)) oldClaims.set(claim.key, claim)
          for (const claim of claims(write.name, write.record)) {
            if (newClaims.has(claim.key) && newClaims.get(claim.key).owner !== claim.owner) throw Object.assign(new Error('Unique field is already in use'), { code: 'ALREADY_EXISTS' })
            newClaims.set(claim.key, claim)
          }
          const encoded = write.record ? encodeApplicationRecord(write.record) : null
          const oldIds = partIds(write.envelope || {}), nextIds = new Set(encoded?.parts.map(part => part.id))
          const obsolete = oldIds.filter(id => !nextIds.has(id))
          writeCount += 1 + (encoded?.parts.length || 0) + obsolete.length
          writeBytes += encoded ? Buffer.byteLength(JSON.stringify(encoded.envelope)) + encoded.parts.reduce((sum, part) => sum + part.value.bytes.length, 0) : 0
          pending.push({ write, encoded, obsolete })
        }
        const claimKeys = [...new Set([...oldClaims.keys(), ...newClaims.keys()])]
        writeCount += claimKeys.length
        if (writeCount > 450 || writeBytes > 8 * 1024 * 1024) throw new Error('Transaction exceeds Firestore atomic write budget')
        // Read ALL claims before performing ANY native write.
        const claimSnapshots = claimKeys.length ? await native.getAll(...claimKeys.map(key => root.collection('uniqueKeys').doc(key))) : []
        for (const snapshot of claimSnapshots) {
          const desired = newClaims.get(snapshot.id), existing = snapshot.exists ? snapshot.data() : null
          if (desired && existing && existing.owner !== desired.owner && oldClaims.get(snapshot.id)?.owner !== existing.owner) throw Object.assign(new Error('Unique field is already in use'), { code: 'ALREADY_EXISTS' })
          if (!desired && existing && oldClaims.get(snapshot.id)?.owner !== existing.owner) throw new Error('Unique field ownership mismatch')
          // Imported records predate unique-key claims. Indexed lookups prevent a
          // newly created account from claiming an already imported email/code.
          if (desired && !existing) {
            let query = collection(desired.name)
            desired.fields.forEach((field, index) => { query = query.where(fieldPath(field), '==', desired.values[index]) })
            const matches = await native.get(query.limit(2))
            for (const match of matches.docs) {
              const owner = `${desired.name}/${match.get('data._id')}`
              if (owner !== desired.owner && oldClaims.get(snapshot.id)?.owner !== owner) throw Object.assign(new Error('Unique field is already in use'), { code: 'ALREADY_EXISTS' })
            }
          }
        }
        for (const { write, encoded, obsolete } of pending) {
          if (encoded) native.set(write.ref, { ...encoded.envelope, digest: recordDigest(write.record) })
          else native.delete(write.ref)
          for (const part of encoded?.parts || []) native.set(write.ref.collection('parts').doc(part.id), part.value)
          for (const id of obsolete) native.delete(write.ref.collection('parts').doc(id))
        }
        for (const key of claimKeys) {
          const reference = root.collection('uniqueKeys').doc(key)
          if (newClaims.has(key)) native.set(reference, { owner: newClaims.get(key).owner })
          else native.delete(reference)
        }
        return result
      })
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

export function createTenantFirestoreStore({ auth, firestore = getTalioFirestore(), dataset = process.env.FIRESTORE_DATASET, constraints, queryFields }) {
  if (!auth?.success || !auth.user || !auth.tenant?.databaseName) throw new Error('Verified tenant authentication is required')
  return createFirestoreDatabase({ firestore, dataset, databaseName: auth.tenant.databaseName, constraints, queryFields })
}
