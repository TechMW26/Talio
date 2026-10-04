jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/tasks.server', () => ({ taskHandler: fn => fn }))
jest.mock('@/lib/leaveApi.server', () => ({ afterChange: jest.fn() }))
jest.mock('@/lib/companyFeatures.server', () => ({ getTenantCompanyFeaturePayload: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { APPLICATION_SEARCH_OPTIONS, searchApplicationRecords } from '@/lib/applicationSearch.server'
import { resolveTeamViewScope, scopedEmployeeRows } from '@/lib/teamViews.server'
jest.setTimeout(60000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('native dashboard scopes and indexed search', () => {
  let firestore, database, other
  const employee = { _id: 'employee', firstName: 'Worker', department: 'department', company: 'company', status: 'active' }, user = { _id: 'user', employeeId: 'employee', role: 'employee' }
  beforeAll(() => { if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required'); firestore = new Firestore({ projectId: 'demo-talio-firestore' }) })
  beforeEach(async () => {
    const dataset = `test-dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    database = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_dashboard', ...APPLICATION_SEARCH_OPTIONS })
    other = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_other', ...APPLICATION_SEARCH_OPTIONS })
    await database.create('employees', employee)
  })
  afterAll(async () => { await firestore?.terminate() })
  test('department heads only resolve their department and explicit reports, never another tenant', async () => {
    await database.create('departments', { _id: 'department', isActive: true, head: 'head' })
    await database.create('employees', { _id: 'report', firstName: 'Direct', reportingManager: 'head', status: 'active' })
    await database.create('employees', { _id: 'outsider', department: 'other-department', status: 'active' })
    await other.create('employees', { _id: 'secret', department: 'department', status: 'active' })
    const scope = await resolveTeamViewScope(database, { employeeId: 'head', role: 'employee' })
    expect(scope.members.map(row => row._id).sort()).toEqual(['employee', 'report'])
    await database.create('leaves', { _id: 'own', employee: 'employee', status: 'pending' })
    await database.create('leaves', { _id: 'outside', employee: 'outsider', status: 'pending' })
    expect((await scopedEmployeeRows(database, 'leaves', scope.members.map(row => row._id))).map(row => row._id)).toEqual(['own'])
  })
  test('document search restricts ownership and excludes other tenants and archived documents', async () => {
    for (const row of [{ _id: 'own', employee: 'employee' }, { _id: 'outside', employee: 'other' }, { _id: 'archived', employee: 'employee', deletedAt: new Date() }]) await database.create('documents', { ...row, title: 'Passport document' })
    await other.create('documents', { _id: 'secret', employee: 'employee', title: 'Passport document' })
    const results = await searchApplicationRecords(database, user, employee, 'passport', path => path === '/dashboard/documents')
    expect(results.documents.map(row => row._id)).toEqual(['own'])
    expect((await searchApplicationRecords(database, { ...user, role: 'hr' }, employee, 'passport', path => path === '/dashboard/documents')).documents).toHaveLength(2)
  })
  test('policy and announcement searches respect specific employee, company and department audiences', async () => {
    for (const row of [{ _id: 'all', applicableTo: 'all' }, { _id: 'specific-own', applicableTo: 'specific', specificEmployees: ['employee'] }, { _id: 'specific-other', applicableTo: 'specific', specificEmployees: ['other'] }, { _id: 'company-other', applicableTo: 'company', companies: ['other'] }]) await database.create('policies', { ...row, title: 'Security policy', isActive: true })
    await database.create('announcements', { _id: 'announcement-own', title: 'Security update', status: 'published', targetAudience: 'specific', specificEmployees: ['employee'] })
    await database.create('announcements', { _id: 'announcement-other', title: 'Security update', status: 'published', targetAudience: 'specific', specificEmployees: ['other'] })
    const results = await searchApplicationRecords(database, user, employee, 'security', path => ['/dashboard/announcements', '/dashboard/policies'].includes(path))
    expect(results.policies.map(row => row._id).sort()).toEqual(['all', 'specific-own'])
    expect(results.announcements.map(row => row._id)).toEqual(['announcement-own'])
  })
  test('disabled feature categories make no database queries', async () => {
    const blocked = { list: jest.fn(() => { throw new Error('Must not read') }) }
    const results = await searchApplicationRecords(blocked, user, employee, 'search', () => false)
    expect(blocked.list).not.toHaveBeenCalled(); expect(Object.values(results).flat()).toHaveLength(0)
  })
  test('team membership batches account for extra IN filters and range sorting', async () => {
    const ids = Array.from({ length: 35 }, (_, index) => `batch-employee-${index}`), date = new Date('2026-10-04T00:00:00Z')
    await Promise.all(ids.map((employee, index) => database.create('leaves', { _id: `batch-leave-${index}`, employee, status: index % 2 ? 'pending' : 'approved', startDate: date })))
    const rows = await scopedEmployeeRows(database, 'leaves', ids, [{ field: 'status', operator: 'in', value: ['pending', 'approved'] }, { field: 'startDate', operator: '>=', value: date }], { orderBy: [{ field: 'startDate' }] })
    expect(rows).toHaveLength(35)
  })
})
