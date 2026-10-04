import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { DIRECTORY_STORE_OPTIONS, listDirectory } from '../../lib/services/directoryService.server'
jest.mock('../../lib/cache', () => ({ buildCacheKey: jest.fn(), getCache: jest.fn(), setCache: jest.fn() }))

jest.setTimeout(45000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
emulator('native employee contact directory', () => {
  let firestore, database
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    database = createFirestoreDatabase({ firestore, dataset: `test-directory-${Date.now()}`, databaseName: 'talio_company_directory', ...DIRECTORY_STORE_OPTIONS })
    await database.create('departments', { _id: 'eng', name: 'Engineering', code: 'ENG' })
    await database.create('designations', { _id: 'dev', title: 'Developer', levelName: 'Senior' })
    for (const [index, firstName, status, role] of [[0, 'Admin', 'active', 'admin'], [1, 'Bea', 'probation', 'employee'], [2, 'Cy', 'on_leave', 'employee'], [3, 'Dee', 'terminated', 'employee']]) {
      await database.create('employees', { _id: `employee-${index}`, firstName, lastName: 'Person', status, department: 'eng', designation: 'dev', email: `${index}@example.test`, salary: { basic: 100 }, profilePicture: '/avatar.png' })
      await database.create('users', { _id: `user-${index}`, employeeId: `employee-${index}`, role, isActive: true, password: 'not-returned' })
    }
  })
  afterAll(async () => firestore?.terminate())
  const list = options => listDirectory({ database, tenantId: database.databaseName, currentUserId: 'user-1', ...options })
  test('excludes self and admins before pagination and includes on-leave employees', async () => {
    const rows = await list({ includeAdmins: false, limit: 1 })
    expect(rows.map(row => row._id)).toEqual(['employee-2'])
    expect(await list({ includeAdmins: false, limit: 1, page: 2 })).toEqual([])
    expect(rows[0].salary).toBeUndefined()
    expect(rows[0].password).toBeUndefined()
  })
  test('searches employee terms and department/designation without collection scans', async () => {
    expect((await list({ query: 'bea person', includeSelf: true })).map(row => row._id)).toEqual(['employee-1'])
    expect(await list({ query: 'engineering', includeAdmins: false, includeSelf: true })).toHaveLength(2)
    expect(await list({ query: 'senior', includeAdmins: false, includeSelf: true })).toHaveLength(2)
    expect(await list({ query: '.*' })).toEqual([])
  })
  test('rejects a caller/database tenant mismatch', async () => {
    await expect(listDirectory({ database, tenantId: 'other', currentUserId: 'user-1' })).rejects.toThrow('Verified tenant')
  })
  test('joins active users in component-safe batches for a full directory page', async () => {
    await Promise.all(Array.from({ length: 31 }, async (_, index) => {
      await database.create('employees', { _id: `batch-employee-${index}`, firstName: `Batch${index}`, lastName: 'Person', status: 'active' })
      await database.create('users', { _id: `batch-user-${index}`, employeeId: `batch-employee-${index}`, role: 'employee', isActive: true })
    }))
    const result = await list({ limit: 100, includeSelf: true })
    expect(result.filter(row => row._id.startsWith('batch-employee-'))).toHaveLength(31)
    expect(result.filter(row => row.userId?.startsWith('batch-user-'))).toHaveLength(31)
  })
})
