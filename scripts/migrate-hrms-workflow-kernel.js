/**
 * Adds canonical HRMS module flags and workflow indexes to every active tenant.
 * Dry-run is the default; use `DRY_RUN=false npm run migrate:hrms-workflows` to apply.
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import {
  HRMS_WORKFLOW_MIGRATION_VERSION,
  buildHrmsFeatureMigration,
  changedFeatureFlags,
} from '../lib/hrms/migration.js'

const dryRun = process.env.DRY_RUN !== 'false'
const mongoUri = process.env.MONGODB_URI

async function createWorkflowIndexes(connection) {
  const workflows = connection.collection('hrmsworkflows')
  const events = connection.collection('hrmsworkflowevents')
  await Promise.all([
    workflows.createIndex({ caseNumber: 1 }, { unique: true, name: 'caseNumber_1' }),
    workflows.createIndex({ module: 1, status: 1, createdAt: -1 }, { name: 'module_status_createdAt' }),
    workflows.createIndex({ subjectEmployee: 1, createdAt: -1 }, { name: 'subjectEmployee_createdAt' }),
    workflows.createIndex({ owner: 1, status: 1, createdAt: -1 }, { name: 'owner_status_createdAt' }),
    workflows.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: 'idempotencyKey_1' }),
    events.createIndex({ workflow: 1, createdAt: -1 }, { name: 'workflow_createdAt' }),
    events.createIndex({ module: 1, createdAt: -1 }, { name: 'module_createdAt' }),
  ])
}

async function main() {
  if (!mongoUri) throw new Error('MONGODB_URI is required')
  const admin = await mongoose.createConnection(mongoUri, { dbName: 'talio_superadmin', maxPoolSize: 3 }).asPromise()
  const companyCollection = admin.collection('tenantcompanies')
  const companies = await companyCollection.find({ isActive: { $ne: false } }, { projection: { databaseName: 1, name: 1, features: 1, migrations: 1 } }).toArray()
  const summary = { dryRun, tenants: companies.length, changedTenants: 0, flagsAddedOrChanged: 0, indexesSynced: 0, errors: [] }

  for (const company of companies) {
    try {
      const features = buildHrmsFeatureMigration(company.features || {})
      const changed = changedFeatureFlags(company.features || {}, features)
      if (changed.length) {
        summary.changedTenants += 1
        summary.flagsAddedOrChanged += changed.length
      }
      console.log(`[HRMS migration] ${company.name || company.databaseName}: ${changed.length} feature flag change(s)`)
      if (dryRun) continue

      await companyCollection.updateOne(
        { _id: company._id },
        { $set: { features, 'migrations.hrmsWorkflowKernelVersion': HRMS_WORKFLOW_MIGRATION_VERSION } }
      )
      const tenant = await mongoose.createConnection(mongoUri, { dbName: company.databaseName, maxPoolSize: 2 }).asPromise()
      try {
        await createWorkflowIndexes(tenant)
        summary.indexesSynced += 1
      } finally {
        await tenant.close()
      }
    } catch (error) {
      summary.errors.push({ tenant: company.databaseName, message: error.message })
    }
  }

  await admin.close()
  console.log(JSON.stringify(summary, null, 2))
  if (summary.errors.length) process.exitCode = 1
}

main().catch((error) => {
  console.error('[HRMS migration] Fatal:', error.message)
  process.exitCode = 1
})
