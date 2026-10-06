// Opt-in test instrumentation: capture query shapes, never values or documents.
// Firestore Emulator does not enforce composite indexes, so this corpus is also
// checked against the checked-in deployment manifest after emulator tests.
jest.mock('@/lib/platform/firestoreStore.server', () => {
  const actual = jest.requireActual('@/lib/platform/firestoreStore.server')
  const fs = require('node:fs')
  function record(collection, options = {}, kind = 'list') {
    if (!process.env.FIRESTORE_QUERY_AUDIT_FILE) return
    const filters = (options.filters || []).map(({ field, operator, value }) => ({ field, operator, ...(Array.isArray(value) ? { size: value.length } : {}) }))
    fs.appendFileSync(process.env.FIRESTORE_QUERY_AUDIT_FILE, JSON.stringify({ collection, kind, filters, orderBy: options.orderBy || [], test: expect.getState().testPath?.split('/tests/')[1] }) + '\n')
  }
  return { ...actual, createFirestoreDatabase: options => {
    const store = actual.createFirestoreDatabase(options)
    return { ...store,
      list: (collection, query) => { record(collection, query); return store.list(collection, query) },
      count: (collection, filters) => { record(collection, { filters }, 'count'); return store.count(collection, filters) },
      transaction: (callback, options) => store.transaction(tx => callback({ ...tx, list: (collection, query) => { record(collection, query, 'transaction'); return tx.list(collection, query) } }), options),
    }
  } }
})
