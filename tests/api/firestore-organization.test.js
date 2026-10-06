import { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { ORGANIZATION_STORE_OPTIONS, saveDepartment, saveTeam, populateDepartment } from '@/lib/organization.server'
import { syncDepartmentHeadStatus } from '@/lib/departmentHeadSync'

jest.setTimeout(45000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('native departments and teams', () => {
  let firestore, database, department
  const first = '111111111111111111111111', second = '222222222222222222222222', firstUser = '333333333333333333333333', secondUser = '444444444444444444444444'
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(async () => { await firestore?.terminate() })
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: `test-organization-${Date.now()}-${randomBytes(5).toString('hex')}`, databaseName: 'talio_company_test', ...ORGANIZATION_STORE_OPTIONS })
    for (const id of [first, second]) await database.create('employees', { _id: id, firstName: 'Example', lastName: id === first ? 'One' : 'Two', status: 'active' })
    await database.create('users', { _id: firstUser, employeeId: first, role: 'employee', isActive: true })
    await database.create('users', { _id: secondUser, employeeId: second, role: 'employee', isActive: true })
    department = await saveDepartment(database, { name: 'Engineering', code: 'ENG', heads: [first] })
  })
  test('head mirrors change atomically and metadata-only edits retain assignments', async () => {
    expect((await database.get('users', firstUser)).headOfDepartments).toEqual([department._id])
    await saveDepartment(database, { description: 'Updated' }, department._id)
    expect((await database.get('users', firstUser)).isDepartmentHead).toBe(true)
    await saveDepartment(database, { heads: [second] }, department._id)
    expect((await database.get('users', firstUser)).isDepartmentHead).toBe(false)
    expect((await database.get('users', secondUser)).isDepartmentHead).toBe(true)
  })
  test('manager assignment and removal update role, without demoting department heads', async () => {
    await expect(saveDepartment(database, { employeeIds: [first] }, department._id, 'managers-add')).rejects.toThrow('department head')
    await saveDepartment(database, { employeeIds: [second] }, department._id, 'managers-add')
    expect(await database.get('users', secondUser)).toMatchObject({ role: 'department_manager', isDepartmentManager: true })
    await saveDepartment(database, { employeeIds: [second] }, department._id, 'managers-remove')
    expect(await database.get('users', secondUser)).toMatchObject({ role: 'employee', isDepartmentManager: false })
  })
  test('team membership, department reference, and account mirrors remain consistent', async () => {
    const team = await saveTeam(database, { employeeId: first }, { teamName: 'Platform', teamCode: 'PLAT', department: department._id, teamLeaders: [first], members: [second] })
    expect((await database.get('departments', department._id)).teams).toEqual([team._id])
    expect((await database.get('users', firstUser)).teamLeaderOf).toEqual([team._id])
    await expect(saveTeam(database, {}, { employeeIds: [first] }, team._id, 'members-add')).rejects.toThrow('both')
    await saveTeam(database, {}, {}, team._id, 'delete')
    expect((await database.get('users', secondUser)).teamMemberOf).toEqual([])
    expect((await database.get('departments', department._id)).teams).toEqual([])
    expect((await database.get('teams', team._id)).isActive).toBe(false)
  })
  test('concurrent duplicate team codes cannot create two teams', async () => {
    const input = { teamName: 'Platform', teamCode: 'PLAT', department: department._id }
    const results = await Promise.allSettled([saveTeam(database, {}, input), saveTeam(database, {}, input)])
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(await database.count('teams')).toBe(1)
  })
  test('user write failure rolls back the department change', async () => {
    const failing = { ...database, transaction: callback => database.transaction(tx => callback({ ...tx, replace: (name, record) => name === 'users' ? Promise.reject(new Error('User unavailable')) : tx.replace(name, record) })) }
    await expect(saveDepartment(failing, { heads: [second] }, department._id)).rejects.toThrow('User unavailable')
    expect((await database.get('departments', department._id)).heads).toEqual([first])
  })
  test('department count deduplicates legacy and multi-department membership; deletion prevents orphaning', async () => {
    await database.mutate('employees', first, record => ({ ...record, department: department._id, departments: [department._id] }))
    await database.mutate('employees', second, record => ({ ...record, departments: [department._id] }))
    expect((await populateDepartment(database, department)).employeeCount).toBe(2)
    await expect(saveDepartment(database, {}, department._id, 'delete')).rejects.toMatchObject({ status: 409 })
  })
  test('reconciliation clears stale flags and restores authoritative active heads', async () => {
    await database.mutate('users', firstUser, record => ({ ...record, isDepartmentHead: false, headOfDepartments: [] }))
    await database.mutate('users', secondUser, record => ({ ...record, isDepartmentHead: true, headOfDepartments: [department._id] }))
    expect((await syncDepartmentHeadStatus(null, database)).updated).toBe(2)
    expect((await database.get('users', firstUser)).isDepartmentHead).toBe(true)
    expect((await database.get('users', secondUser)).isDepartmentHead).toBe(false)
  })
})
