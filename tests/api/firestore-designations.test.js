import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { DESIGNATION_STORE_OPTIONS, saveDesignation, deleteDesignation, listDesignations } from '../../lib/designations.server'

jest.setTimeout(45000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
emulator('native designation constraints', () => {
  let firestore, database, other
  const hr = { role: 'hr' }
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    const dataset = `test-designations-${Date.now()}`
    database = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_designations', ...DESIGNATION_STORE_OPTIONS })
    other = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_other', ...DESIGNATION_STORE_OPTIONS })
  })
  afterAll(async () => firestore?.terminate())
  test('requires management permission and retains schema validation', async () => {
    await expect(saveDesignation(database, { role: 'employee' }, { title: 'Director' })).rejects.toMatchObject({ status: 403 })
    await expect(saveDesignation(database, hr, { title: ' ' })).rejects.toMatchObject({ status: 400 })
    await expect(saveDesignation(database, hr, { title: 'Director', isActive: 'false' })).rejects.toMatchObject({ status: 400 })
  })
  test('concurrent duplicate titles cannot create duplicate records', async () => {
    const results = await Promise.allSettled([saveDesignation(database, hr, { title: 'Director' }), saveDesignation(database, hr, { title: 'Director' })])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await database.count('designations')).toBe(1)
    expect(await listDesignations(other)).toEqual([])
  })
  test('code suffix allocation, partial updates, and reference protection work', async () => {
    const first = await saveDesignation(database, hr, { title: 'QA/Test', level: 3 })
    const second = await saveDesignation(database, hr, { title: 'QA Test', level: 4 })
    expect([first.code, second.code]).toEqual(['QA-TEST', 'QA-TEST-2'])
    const updated = await saveDesignation(database, hr, { description: 'Updated', _id: 'overwrite', code: 'overwrite' }, first._id)
    expect(updated.level).toBe(3)
    expect(updated.code).toBe(first.code)
    expect(updated._id).toBe(first._id)
    await database.create('employees', { _id: 'employee-reference', designation: first._id })
    await expect(deleteDesignation(database, hr, first._id)).rejects.toMatchObject({ status: 409 })
    await deleteDesignation(database, hr, second._id)
    expect(await database.get('designations', second._id)).toBeNull()
  })
})
