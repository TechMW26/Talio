import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { EMPLOYEE_STORE_OPTIONS, employeeSearchGrams, listEmployees } from '../../lib/employees.server'

jest.setTimeout(45000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
const first = '111111111111111111111111', second = '222222222222222222222222', department = 'aaaaaaaaaaaaaaaaaaaaaaaa', team = 'bbbbbbbbbbbbbbbbbbbbbbbb'
emulator('native employee roster queries', () => {
  let firestore, database
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    database = createFirestoreDatabase({ firestore, dataset: `test-employees-${Date.now()}`, databaseName: 'talio_company_roster', ...EMPLOYEE_STORE_OPTIONS })
    await database.create('departments', { _id: department, name: 'Engineering', code: 'ENG', internalSecret: 'must-not-leak' })
    for (const record of [
      { _id: first, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', employeeCode: 'E1', status: 'active', department, departments: [department], designationLevel: 3 },
      { _id: second, firstName: 'Alan', lastName: 'Turing', email: 'alan@example.test', employeeCode: 'E2', status: 'probation', designationLevel: 4 },
    ]) await database.create('employees', { ...record, searchGrams: employeeSearchGrams(record), createdAt: new Date('2026-01-01'), bankDetails: { accountNumber: 'not-in-roster' } })
    await database.create('users', { _id: 'user', employeeId: first, email: 'ada@example.test', role: 'employee', password: 'never-returned' })
    await database.create('teams', { _id: team, members: [second], teamLeaders: [first] })
  })
  afterAll(async () => firestore?.terminate())
  test('native pagination and count are stable and joins expose only intended fields', async () => {
    const result = await listEmployees(database, new URLSearchParams('limit=1&sortBy=firstName&sortOrder=asc'))
    expect(result.pagination).toEqual({ page: 1, limit: 1, total: 2, pages: 2 })
    expect(result.data[0]).toMatchObject({ _id: first, department: { name: 'Engineering' }, userId: { email: 'ada@example.test', role: 'employee' } })
    expect(result.data[0].bankDetails).toBeUndefined()
    expect(result.data[0].department.internalSecret).toBeUndefined()
    expect(result.data[0].userId.password).toBeUndefined()
    const next = await listEmployees(database, new URLSearchParams('page=2&limit=1&sortBy=firstName&sortOrder=asc'))
    expect(next.data[0]._id).toBe(second)
  })
  test('indexed substring search preserves all-term matching and filters', async () => {
    const result = await listEmployees(database, new URLSearchParams('search=ada+love&status=active'))
    expect(result.data.map(record => record._id)).toEqual([first])
    expect((await listEmployees(database, new URLSearchParams('search=ada+turing'))).data).toEqual([])
    expect((await listEmployees(database, new URLSearchParams(`search=ada&department=${department}`))).data).toHaveLength(1)
  })
  test('team ID reads include leaders, respect filters, and validate inputs', async () => {
    expect((await listEmployees(database, new URLSearchParams(`team=${team}&status=probation`))).data.map(record => record._id)).toEqual([second])
    await expect(listEmployees(database, new URLSearchParams('team=bad'))).rejects.toMatchObject({ status: 400 })
    await expect(listEmployees(database, new URLSearchParams('level=100'))).rejects.toMatchObject({ status: 400 })
    const departments = Array.from({ length: 16 }, (_, index) => index.toString(16).padStart(24, '0')).join(',')
    await expect(listEmployees(database, new URLSearchParams(`departments=${departments}&status=active,probation`))).rejects.toMatchObject({ status: 400 })
    const broadDepartments = Array.from({ length: 25 }, (_, index) => index.toString(16).padStart(24, '0')).join(',')
    await expect(listEmployees(database, new URLSearchParams(`departments=${broadDepartments}&status=active&level=3`))).rejects.toMatchObject({ status: 400 })
  })
  test('ordinary mutations automatically refresh the indexed search projection', async () => {
    await database.mutate('employees', second, current => ({ ...current, lastName: 'Renamed', searchGrams: ['stale'] }))
    const result = await listEmployees(database, new URLSearchParams('search=renamed'))
    expect(result.data.map(record => record._id)).toEqual([second])
    expect((await listEmployees(database, new URLSearchParams('search=turing'))).data).toEqual([])
  })
})
