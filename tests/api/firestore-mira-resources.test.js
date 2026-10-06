import { randomBytes } from 'node:crypto'
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getMiraResourceStore, getVisibleProjects, getVisibleTasks, getVisibleMeetings } from '@/lib/platform/firestoreMiraResources.server'
import { getProductivityViewStore, getProductivityVisibility } from '@/lib/platform/firestoreProductivityView.server'

jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
jest.setTimeout(30000)
emulator('Native Mira resource scope and projections', () => {
  let firestore, store
  const databaseName = 'talio_company_mira_scope'
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(async () => firestore.terminate())
  beforeEach(async () => {
    const dataset = 'test-mira-scope-' + randomBytes(8).toString('hex')
    getFirestoreTenantDatabase.mockImplementation(async (name, options = {}) => {
      if (name !== databaseName) throw new Error('Wrong tenant')
      return createFirestoreDatabase({ firestore, dataset, databaseName, ...options })
    })
    store = await getMiraResourceStore(databaseName)
  })
  test('membership, department and assigned-team project grants do not expose unrelated projects', async () => {
    for (const record of [{ _id: 'member', name: 'Launch member' }, { _id: 'dept', name: 'Launch department', department: 'dept' }, { _id: 'team', name: 'Launch team', assignedTeams: ['team'] }, { _id: 'other', name: 'Launch secret' }]) await store.create('projects', record)
    await store.create('projectmembers', { _id: 'membership', user: 'own', project: 'member', invitationStatus: 'accepted' })
    const user = { employeeId: 'own', role: 'employee', headOfDepartments: ['dept'], teamLeaderOf: ['team'] }
    expect((await getVisibleProjects(store, user, { search: 'launch' })).map(value => value._id).sort()).toEqual(['dept', 'member', 'team'])
    expect(await getVisibleProjects(store, user, { id: 'other' })).toEqual([])
    expect((await getVisibleProjects(store, { ...user, role: 'admin' }, { search: 'launch' })).length).toBe(4)
    await store.mutate('projects', 'member', record => ({ ...record, name: 'Renamed' }))
    expect((await getVisibleProjects(store, user, { search: 'renamed' })).map(value => value._id)).toEqual(['member'])
    expect((await getVisibleProjects(store, user, { search: 'launch' })).some(value => value._id === 'member')).toBe(false)
  })
  test('task assignment and meeting invitees are tenant-scoped native joins', async () => {
    await store.create('tasks', { _id: 'task', title: 'Review report', createdBy: 'other' })
    await store.create('taskassignees', { _id: 'assignment', user: 'own', task: 'task', assignmentStatus: 'accepted' })
    await store.create('meetings', { _id: 'meeting', title: 'Review meeting', organizer: 'other', invitees: [{ employee: 'own', status: 'accepted' }] })
    const user = { employeeId: 'own', role: 'employee' }
    expect((await getVisibleTasks(store, user, { search: 'review' })).map(value => value._id)).toEqual(['task'])
    expect(await getVisibleTasks(store, user, { search: 'review', assignOnly: true })).toEqual([])
    expect((await getVisibleMeetings(store, user, { search: 'review' })).map(value => value._id)).toEqual(['meeting'])
    expect((await store.get('meetings', 'meeting')).inviteeEmployeeIds).toEqual(['own'])
    expect(await getVisibleMeetings(store, { employeeId: 'stranger' }, { id: 'meeting' })).toEqual([])
  })
  test('team productivity combines explicit reports without broadening manager role', async () => {
    const view = await getProductivityViewStore(databaseName)
    await view.create('users', { _id: 'user', employeeId: 'own' })
    await view.create('employees', { _id: 'own', status: 'active' })
    await view.create('employees', { _id: 'report', status: 'active', assignedManager: 'own' })
    await view.create('employees', { _id: 'other', status: 'active', assignedManager: 'stranger' })
    expect((await getProductivityVisibility(view, { _id: 'user', role: 'manager' }, { activeOnly: true })).employees.map(value => value._id)).toEqual(['report'])
  })
})
