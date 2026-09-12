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
    const existing = new Set(
      (await collection.listIndexes().toArray().catch(() => []))
        .map(index => index.name)
    )

    for (const definition of definitions) {
      if (existing.has(definition.name)) continue
      if (!dryRun) {
        await collection.createIndex(definition.key, { name: definition.name, background: true })
      }
      created++
    }
  }
  return created
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

main().catch((error) => {
  console.error('[Performance indexes] Fatal:', error.message)
  process.exitCode = 1
})
