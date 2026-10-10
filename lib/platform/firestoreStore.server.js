import { createMongoDatabase } from './mongoStore.server'
import { MAX_MONGO_MEMBERSHIP_VALUES } from './mongoQueryPolicy.cjs'

// Retain established helper exports/import paths while the application data
// plane is MongoDB-only. Firebase Admin remains exclusively for notifications.
export function assertFirestoreDataset(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{7,79}$/.test(value)) throw new TypeError('Explicit MONGODB_DATASET is required')
  return value
}

/** Established import name retained for domain callers. MongoDB has no
 * Firestore disjunction/component ceiling; keep only our explicit work bound.
 * This avoids splitting one scoped indexed read into many tiny round trips. */
export function getFirestoreMembershipBatchSize() {
  return MAX_MONGO_MEMBERSHIP_VALUES
}

export function createFirestoreDatabase(options = {}) {
  assertFirestoreDataset(options.dataset)
  return createMongoDatabase(options)
}

export function createTenantFirestoreStore({ auth, mongo, db = mongo, client = db?.client, dataset = process.env.MONGODB_DATASET, constraints, queryFields }) {
  if (!auth?.success || !auth.user || !auth.tenant?.databaseName) throw new Error('Verified tenant authentication is required')
  return createFirestoreDatabase({ db, client, dataset, databaseName: auth.tenant.databaseName, constraints, queryFields })
}
