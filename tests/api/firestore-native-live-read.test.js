// Explicit read-only acceptance. Never connects to the source database, writes
// user records, starts jobs, or sends a real notification.
import fs from 'node:fs'
import dotenv from 'dotenv'
import { deleteApp, getApps } from 'firebase-admin/app'
import { getTalioFirestore } from '../../lib/platform/firestore.server'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { createFirestoreMediaRepository } from '../../lib/platform/firestoreMedia.server'
import { get as readBlob } from '@vercel/blob'

const dataset = process.env.TALIO_FIRESTORE_NATIVE_READ_DATASET
const live = dataset ? describe : describe.skip
live('native Firestore application dataset acceptance', () => {
  let firestore, catalog
  beforeAll(async () => {
    if (!/^local-[a-z0-9-]{6,70}$/.test(dataset)) throw new Error('Local acceptance dataset required')
    const env = dotenv.parse(fs.readFileSync('.env'))
    firestore = getTalioFirestore({ FIRESTORE_PROJECT_ID: 'talio-hrms', FIRESTORE_SERVICE_ACCOUNT_JSON: env.FIREBASE_SERVICE_ACCOUNT_KEY })
    const snapshot = await firestore.collection('talioDatasets').doc(dataset).get()
    catalog = snapshot.data()
    if (catalog.status !== 'verified-local-dataset' || catalog.applicationCutover !== false) throw new Error('Dataset is not a verified isolated copy')
  }, 30000)
  afterAll(async () => {
    await firestore?.terminate()
    const app = getApps().find(value => value.name === 'talio-firestore-data')
    if (app) await deleteApp(app)
  })
  test('native repositories query both tenants and preserve ID isolation', async () => {
    for (const tenant of catalog.tenants) {
      const store = createFirestoreDatabase({ firestore, dataset, databaseName: tenant.databaseName, queryFields: { users: ['isActive'] } })
      const page = await store.list('users', { filters: [{ field: 'isActive', operator: '==', value: true }], limit: 1 })
      expect(page.records.length === 1).toBe(true)
      const record = await store.get('users', page.records[0]._id)
      expect(record._id === page.records[0]._id).toBe(true)
      const other = catalog.tenants.find(value => value.databaseName !== tenant.databaseName)
      const foreign = createFirestoreDatabase({ firestore, dataset, databaseName: other.databaseName })
      expect(await foreign.get('users', record._id)).toBeNull()
    }
  }, 60000)
  test.each([
    ['employees', 'firstName'],
    ['projects', 'createdAt'],
    ['tasks', 'createdAt'],
  ])('executes a real indexed %s filter with ordering and pagination', async (collection, sortField) => {
    const store = createFirestoreDatabase({
      firestore, dataset, databaseName: 'talio_company_mushroom_world_group',
      queryFields: { [collection]: ['status', sortField] },
    })
    const sample = await store.list(collection, { limit: 1 })
    expect(sample.records.length > 0).toBe(true)
    const status = sample.records[0].status
    expect(typeof status === 'string').toBe(true)
    const options = { filters: [{ field: 'status', operator: '==', value: status }], orderBy: [{ field: sortField, direction: 'asc' }], limit: 2 }
    const page = await store.list(collection, options)
    expect(page.records.length > 0).toBe(true)
    expect(page.records.every(record => record.status === status)).toBe(true)
    if (page.nextCursor) {
      const next = await store.list(collection, { ...options, cursor: page.nextCursor })
      expect(next.records.every(record => !page.records.some(previous => previous._id === record._id))).toBe(true)
    }
  }, 60000)
  test('executes sidebar pending counts with a non-equality employee exclusion', async () => {
    const store = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_mushroom_world_group', queryFields: { leaves: ['status', 'employee'] } })
    const count = await store.count('leaves', [{ field: 'status', operator: '==', value: 'pending' }, { field: 'employee', operator: '!=', value: 'local-read-only-nonexistent-employee' }])
    expect(Number.isInteger(count) && count >= 0).toBe(true)
  }, 60000)
  test('reads a previously archive-only MIRA table record through the native repository', async () => {
    const databaseName = 'talio_company_mushroom_world_group'
    const store = createFirestoreDatabase({ firestore, dataset, databaseName })
    // One metadata-only bounded lookup locates a fragmented record; application
    // payloads are intentionally never included in assertion error messages.
    const candidates = await firestore.collection('talioDatasets').doc(dataset).collection('databases').doc(databaseName).collection('collections').doc('mirachatsessions').collection('records').limit(100).get()
    const candidate = candidates.docs.find(doc => doc.get('overflow')?.length)
    expect(Boolean(candidate)).toBe(true)
    const record = await store.get('mirachatsessions', candidate.get('data._id'))
    expect(Array.isArray(record.messages)).toBe(true)
    expect(JSON.stringify(record.messages).length > 0).toBe(true)
  }, 30000)
  test('reads migrated private media with ownership checks and byte verification', async () => {
    const databaseName = 'talio_company_mushroom_world_group'
    const store = createFirestoreDatabase({ firestore, dataset, databaseName })
    const files = await store.list('images.files', { limit: 1 })
    const env = dotenv.parse(fs.readFileSync('.vercel/.env.migration-source.local'))
    const repository = createFirestoreMediaRepository({ firestore, dataset, databaseName, readBlob: (pathname, options) => readBlob(pathname, { ...options, token: env.BLOB_READ_WRITE_TOKEN, abortSignal: AbortSignal.timeout(15000) }) })
    const result = await repository.open('images', files.records[0]._id, () => true)
    let count = 0
    for await (const chunk of result.stream) count += chunk.byteLength
    expect(count === result.length).toBe(true)
  }, 30000)
})
