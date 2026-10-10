import { pack, unpack } from '../../lib/platform/firestoreCodec.cjs'

const clone = value => unpack(pack(value))
const get = (value, path) => path.split('.').reduce((item, key) => item?.[key], value)
/** Isolated contract double; never connects to Atlas. Serializes transaction
 * callbacks to model atomic conflict/rollback outcomes, not wire protocol. */
export function memoryMongoDriver() {
  const banks = new Map(), bank = name => { if (!banks.has(name)) banks.set(name, new Map()); return banks.get(name) }
  const match = (doc, filter) => Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') return condition.every(child => match(doc, child))
    const value = get(doc, key)
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if (condition.$in) return condition.$in.includes(value)
      if (condition.$eq !== undefined) return value === condition.$eq
    }
    return value === condition
  })
  let pending = 0, highest = 0, transactions = Promise.resolve()
  const db = { collection(name) { return {
    async findOne(filter) { pending++; highest = Math.max(highest, pending); await Promise.resolve(); const result = [...bank(name).values()].find(doc => match(doc, filter)); pending--; return result ? clone(result) : null },
    find(filter) { let limit = Infinity; const cursor = { sort: () => cursor, limit(value) { limit = value; return cursor }, async toArray() { return [...bank(name).values()].filter(doc => match(doc, filter)).slice(0, limit).map(clone) } }; return cursor },
    async countDocuments(filter, options = {}) { const count = [...bank(name).values()].filter(doc => match(doc, filter)).length; return options.limit ? Math.min(count, options.limit) : count },
    async bulkWrite(operations) { for (const operation of operations) {
      if (operation.replaceOne) bank(name).set(operation.replaceOne.replacement._id, clone(operation.replaceOne.replacement))
      else if (operation.insertOne) { const doc = operation.insertOne.document; if (bank(name).has(doc._id)) throw Object.assign(new Error('duplicate'), { code: 11000 }); bank(name).set(doc._id, clone(doc)) }
      else for (const [key, doc] of bank(name)) if (match(doc, operation.deleteOne.filter)) bank(name).delete(key)
    } },
  } } }
  const client = { startSession: () => ({ async withTransaction(callback, options) {
    if (options.readConcern?.level !== 'snapshot' || options.writeConcern?.w !== 'majority') throw new Error('Atomic transaction configuration required')
    const run = transactions.then(async () => {
      const backup = new Map([...banks].map(([name, docs]) => [name, new Map([...docs].map(([key, doc]) => [key, clone(doc)]))]))
      try { return await callback() } catch (error) { banks.clear(); for (const [name, docs] of backup) banks.set(name, docs); throw error }
    })
    transactions = run.catch(() => {})
    return run
  }, endSession: async () => {} }) }
  return { db, client, bank, highest: () => highest }
}
