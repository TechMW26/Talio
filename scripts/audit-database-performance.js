// Read-only: no profiler changes, index writes, or document contents in output.
require('dotenv').config({ path: '.env.local', quiet: true })
require('dotenv').config({ quiet: true })
const { MongoClient } = require('mongodb')

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 10000 })
  try {
    const start = Date.now()
    await client.connect()
    const connectionMs = Date.now() - start
    const companies = await client.db('talio_superadmin').collection('tenantcompanies').find({ isActive: { $ne: false }, databaseName: { $type: 'string' } }, { projection: { databaseName: 1 } }).limit(100).toArray()
    for (const [tenant, company] of companies.entries()) {
      const db = client.db(company.databaseName)
      const results = []
      for (const [collection, filter, sort] of [
        ['tasks', {}, { updatedAt: -1 }],
        ['projects', {}, { updatedAt: -1 }],
        ['announcements', { status: 'published' }, { createdAt: -1 }],
        ['meetings', {}, { scheduledStart: -1 }],
      ]) {
        const started = Date.now()
        const plan = await db.collection(collection).find(filter, { projection: { _id: 1 }, maxTimeMS: 5000 }).sort(sort).limit(30).explain('executionStats')
        const stats = plan.executionStats
        const indexes = await db.collection(collection).listIndexes().toArray().catch(e => { if (e.code === 26) return []; throw e })
        results.push({ collection, roundTripMs: Date.now() - started, executionMs: stats?.executionTimeMillis, returned: stats?.nReturned, examined: stats?.totalDocsExamined, keys: stats?.totalKeysExamined, blockingSort: JSON.stringify(plan.queryPlanner?.winningPlan).includes('"SORT"'), indexes: indexes.map(i => i.key) })
      }
      console.log(JSON.stringify({ tenant: tenant + 1, connectionMs, results }))
    }
  } finally { await client.close() }
}
main().catch(error => { console.error('Database audit failed:', error.codeName || error.code || error.name); process.exitCode = 1 })
