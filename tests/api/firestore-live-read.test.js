// Explicit opt-in, read-only cloud acceptance checks. Not part of ordinary CI.
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import { createHash } from 'node:crypto'
import { get as getBlob } from '@vercel/blob'
import { deleteApp, getApps } from 'firebase-admin/app'
import { getTalioFirestore } from '../../lib/platform/firestore.server'
import { createMigratedTenantReader } from '../../lib/platform/firestoreMigration.server'

const run = process.env.TALIO_FIRESTORE_LIVE_READ_RUN
const live = run ? describe : describe.skip

live('read-only Firestore cloud migration acceptance', () => {
  let db, manifest
  beforeAll(() => {
    if (!/^[a-z0-9][a-z0-9-]{7,79}$/.test(run)) throw new Error('Invalid acceptance run')
    manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.migration-data', run, 'manifest.json')))
    const env = dotenv.parse(fs.readFileSync(path.join(process.cwd(), '.env')))
    db = getTalioFirestore({ FIRESTORE_PROJECT_ID: manifest.targetProject, FIRESTORE_SERVICE_ACCOUNT_JSON: env.FIREBASE_SERVICE_ACCOUNT_KEY })
  })
  afterAll(async () => {
    await db?.terminate()
    const app = getApps().find(value => value.name === 'talio-firestore-data')
    if (app) await deleteApp(app)
  })
  test('queries each registered tenant using native indexed fields, without a Mongo connection', async () => {
    for (const tenant of manifest.tenants) {
      const reader = createMigratedTenantReader({ firestore: db, run, auth: { success: true, user: { _id: 'migration-acceptance' }, tenant: { databaseName: tenant.databaseName } } })
      const users = await reader.list('users', { filters: [{ field: 'isActive', operator: '==', value: true }], limit: 1 })
      expect(users.length).toBe(1)
      expect(typeof users[0]._id === 'string' && /^[a-f0-9]{24}$/.test(users[0]._id)).toBe(true)
      const same = await reader.getByObjectId('users', users[0]._id)
      expect(same?._id === users[0]._id).toBe(true)
      const otherTenant = manifest.tenants.find(other => other.databaseName !== tenant.databaseName)
      if (otherTenant) {
        const other = createMigratedTenantReader({ firestore: db, run, auth: { success: true, user: { _id: 'migration-acceptance' }, tenant: { databaseName: otherTenant.databaseName } } })
        expect(Boolean(await other.getByObjectId('users', users[0]._id))).toBe(false)
      }
    }
  }, 60000)
  test('streams a migrated tenant image privately from Blob with the source checksum', async () => {
    const tenant = manifest.tenants.find(value => manifest.collections.some(c => c.database === value.databaseName && c.collection === 'images.files' && c.count > 0))
    expect(Boolean(tenant)).toBe(true)
    const blobEnv = dotenv.parse(fs.readFileSync(path.join(process.cwd(), '.vercel/.env.migration-source.local')))
    const reader = createMigratedTenantReader({ firestore: db, run, auth: { success: true, user: { _id: 'migration-acceptance' }, tenant: { databaseName: tenant.databaseName } }, getBlob: (pathname, options) => getBlob(pathname, { ...options, token: blobEnv.BLOB_READ_WRITE_TOKEN, abortSignal: AbortSignal.timeout(15000) }) })
    const files = await reader.list('images.files', { limit: 1 })
    const result = await reader.openMedia('images', files[0]._id)
    const hash = createHash('sha256'); let bytes = 0
    for await (const chunk of result.stream) { hash.update(chunk); bytes += chunk.length }
    expect(bytes === result.length).toBe(true)
    expect(hash.digest('hex') === result.sha256).toBe(true)
  }, 30000)
})
