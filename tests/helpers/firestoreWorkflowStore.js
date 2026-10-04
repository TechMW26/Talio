// Deterministic native repository contract double. This verifies domain rollback
// and concurrency, not Firestore infrastructure (covered by its own adapter tests).
export function workflowStore(seed = {}) {
  let state = new Map(Object.entries(seed).map(([name, records]) => [name, new Map(records.map(record => [record._id, record]))]))
  let queue = Promise.resolve()
  // Keep values in Jest's realm. v8.deserialize creates foreign prototypes,
  // which correctly fail the production codec's plain-record validation.
  const copy = value => {
    if (value instanceof Date) return new Date(+value)
    if (Buffer.isBuffer(value)) return Buffer.from(value)
    if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, copy(item)]))
    if (Array.isArray(value)) return value.map(copy)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))
    return value
  }
  const read = (database, name, id) => copy(database.get(name)?.get(id) || null)
  const records = (database, name, filters = []) => [...(database.get(name)?.values() || [])].filter(record => filters.every(({ field, operator, value }) => {
    const actual = field.split('.').reduce((current, part) => current?.[part], record)
    if (operator === '==') return actual === value
    if (operator === '!=') return actual !== undefined && actual !== value
    if (operator === 'in') return value.includes(actual)
    if (operator === 'array-contains') return actual?.includes(value)
    if (operator === 'array-contains-any') return actual?.some(item => value.includes(item))
    if (operator === '>') return actual !== undefined && actual > value
    if (operator === '>=') return actual !== undefined && actual >= value
    if (operator === '<') return actual !== undefined && actual < value
    if (operator === '<=') return actual !== undefined && actual <= value
    throw new Error(`Unsupported test filter: ${operator}`)
  }))
  const listing = (database, name, { filters = [], orderBy = [], cursor, limit = 50 } = {}) => {
    let values = records(database, name, filters)
    for (const order of [...orderBy].reverse()) values.sort((a, b) => (a[order.field] < b[order.field] ? -1 : a[order.field] > b[order.field] ? 1 : 0) * (order.direction === 'desc' ? -1 : 1))
    const offset = Number(cursor || 0)
    return copy({ records: values.slice(offset, offset + limit), nextCursor: values.length > offset + limit ? String(offset + limit) : null })
  }
  const store = {
    get: jest.fn(async (name, id) => read(state, name, id)),
    getMany: jest.fn(async (name, ids) => ids.map(id => read(state, name, id))),
    list: jest.fn(async (name, options) => listing(state, name, options)),
    count: jest.fn(async (name, filters) => records(state, name, filters).length),
    failCreate: null,
    transaction: jest.fn(callback => {
      const run = queue.then(async () => {
        const pending = copy(state)
        const tx = {
          get: async (name, id) => read(pending, name, id),
          list: async (name, options) => listing(pending, name, options),
          create: async (name, record) => {
            if (store.failCreate === name) throw new Error('Simulated write failure')
            if (!pending.has(name)) pending.set(name, new Map())
            if (pending.get(name).has(record._id)) throw Object.assign(new Error('Record exists'), { code: 'ALREADY_EXISTS' })
            pending.get(name).set(record._id, copy(record))
          },
          replace: async (name, record) => {
            if (!pending.get(name)?.has(record._id)) throw new Error('Record missing')
            pending.get(name).set(record._id, copy(record))
          },
          delete: async (name, id) => pending.get(name)?.delete(id),
        }
        const result = await callback(tx)
        state = pending
        return result
      })
      queue = run.catch(() => {})
      return run
    }),
    create: async (name, record) => { await store.transaction(tx => tx.create(name, record)); return record },
    mutate: async (name, id, callback) => store.transaction(async tx => { const current = await tx.get(name, id); if (!current) return null; const next = await callback(current); await tx.replace(name, next); return next }),
  }
  return store
}
