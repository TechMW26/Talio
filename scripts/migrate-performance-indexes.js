/**
 * Creates the compound indexes used by Talio's highest-frequency dashboard
 * queries in every active tenant database.
 *
 * Dry-run is the default. Apply with:
 *   DRY_RUN=false npm run migrate:performance-indexes
 */
require('dotenv/config')
const mongoose = require('mongoose')

const dryRun = process.env.DRY_RUN !== 'false'
const mongoUri = process.env.MONGODB_URI

const INDEXES = Object.freeze({
  employees: [
    { key: { createdAt: -1, _id: -1 }, name: 'createdAt_-1__id_-1' },
    { key: { status: 1, createdAt: -1, _id: -1 }, name: 'status_1_createdAt_-1__id_-1' },
  ],
  attendances: [
    { key: { date: 1, status: 1 }, name: 'date_1_status_1' },
    { key: { employee: 1, date: -1 }, name: 'employee_1_date_-1' },
  ],
  performances: [
    { key: { employee: 1, createdAt: -1 }, name: 'employee_1_createdAt_-1' },
    { key: { employee: 1, isActive: 1, createdAt: -1 }, name: 'employee_1_isActive_1_createdAt_-1' },
  ],
})

async function ensureTenantIndexes(connection) {
  let created = 0
  for (const [collectionName, definitions] of Object.entries(INDEXES)) {
    const collection = connection.collection(collectionName)
    const existing = await collection.listIndexes().toArray().catch(error => {
      if (error.code === 26) return [] // Namespace not created yet.
      throw error // Never mask an authorization/network failure as missing indexes.
    })

    for (const definition of definitions) {
      if (existing.some(index => sameIndex(index, definition))) continue
      if (!dryRun) {
        await collection.createIndex(definition.key, { name: definition.name, background: true })
      }
      created++
    }
  }
  return created
}

function sameIndex(existing, requested) {
  return !existing.partialFilterExpression && !existing.sparse && !existing.collation &&
    JSON.stringify(existing.key) === JSON.stringify(requested.key)
}

async function main() {
  if (!mongoUri) throw new Error('MONGODB_URI is required')

  const admin = await mongoose.createConnection(mongoUri, {
    dbName: 'talio_superadmin',
    maxPoolSize: 3,
    minPoolSize: 0,
  }).asPromise()

  const companies = await admin.collection('tenantcompanies')
    .find(
      { isActive: { $ne: false }, databaseName: { $type: 'string' } },
      { projection: { databaseName: 1 } }
    )
    .toArray()

  const summary = { dryRun, tenants: companies.length, indexesCreatedOrMissing: 0, errors: [] }

  for (const company of companies) {
    const tenant = admin.useDb(company.databaseName, { useCache: true, noListener: true })
    try {
      summary.indexesCreatedOrMissing += await ensureTenantIndexes(tenant)
    } catch (error) {
      summary.errors.push({ tenant: company.databaseName, message: error.message })
    }
  }

  await admin.close()
  console.log(JSON.stringify(summary, null, 2))
  if (summary.errors.length) process.exitCode = 1
}

if (require.main === module) main().catch((error) => {
  console.error('[Performance indexes] Fatal:', error.message)
  process.exitCode = 1
})

module.exports = { INDEXES, sameIndex }
