jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { PROJECT_STORE_OPTIONS } from '@/lib/projects.server'
import { createProject, respondToInvitation, checkProjectAccess, requestCompletionApproval, respondToCompletionApproval, calculateCompletionPercentage, updateProjectStatus } from '@/lib/projectService'
jest.setTimeout(60000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
const creator = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', firstName: 'Creator' }, invited = 'bbbbbbbbbbbbbbbbbbbbbbbb'
emulator('native project service', () => {
  let firestore, dataset, database
  beforeAll(() => { if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required'); firestore = new Firestore({ projectId: 'demo-talio-firestore' }) })
  beforeEach(async () => {
    dataset = `test-projects-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    getFirestoreTenantDatabase.mockImplementation(async (databaseName, options) => createFirestoreDatabase({ firestore, dataset, databaseName, ...options }))
    database = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_projects', ...PROJECT_STORE_OPTIONS })
    await database.create('employees', creator); await database.create('employees', { _id: invited, firstName: 'Invited' })
  })
  afterAll(async () => { await firestore?.terminate() })
  const create = () => createProject({ name: 'Native project', startDate: '2026-01-01', endDate: '2026-12-31', projectHeads: [creator._id, invited] }, creator, [], database)
  test('project, memberships, chat and timeline commit together; invitations respond once', async () => {
    const project = await create()
    expect(await database.count('projectmembers')).toBe(2)
    expect((await database.get('chats', project.chatGroup)).participants).toHaveLength(2)
    const results = await Promise.allSettled([true, false].map(accept => respondToInvitation(project._id, invited, accept, '', database)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = (await database.list('projectmembers', { filters: [{ field: 'user', operator: '==', value: invited }], limit: 2 })).records[0].invitationStatus === 'rejected'
    expect((await checkProjectAccess(project._id, invited, 'participate', database)).hasAccess).toBe(!rejected)
    if (rejected) expect((await database.get('projects', project._id)).projectHeads).not.toContain(invited)
  })
  test('missing employee rolls back the entire project', async () => {
    await expect(createProject({ name: 'Invalid', startDate: '2026-01-01', endDate: '2026-12-31', projectHead: 'cccccccccccccccccccccccc' }, creator, [], database)).rejects.toMatchObject({ status: 404 })
    expect(await database.count('projects')).toBe(0); expect(await database.count('chats')).toBe(0)
  })
  test('completion request and response are atomic and require project-head authority', async () => {
    const project = await create()
    await database.create('tasks', { _id: 'task-one', project: project._id, title: 'One', status: 'completed', subtasks: [{ _id: 'sub', completed: true }] })
    expect(await calculateCompletionPercentage(project._id, database)).toBe(100)
    const results = await Promise.allSettled([1, 2].map(() => requestCompletionApproval(project._id, creator, '', database)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const approval = results.find(result => result.status === 'fulfilled').value
    await expect(respondToCompletionApproval(approval._id, { _id: 'stranger' }, true, '', false, database)).rejects.toMatchObject({ status: 403 })
    await respondToCompletionApproval(approval._id, creator, false, 'Needs work', true, database)
    expect((await database.get('tasks', 'task-one')).status).toBe('in-progress')
    expect((await database.get('projects', project._id)).status).toBe('ongoing')
    await expect(respondToCompletionApproval(approval._id, creator, true, '', false, database)).rejects.toMatchObject({ status: 409 })
  })
  test('transaction bounds are explicit, do not change ordinary page limits, and fail atomically', async () => {
    await expect(database.transaction(async () => {}, { maxWrites: 401 })).rejects.toThrow('bound')
    await expect(database.transaction(async tx => { await tx.create('projects', { _id: 'a' }); await tx.create('projects', { _id: 'b' }) }, { maxWrites: 1 })).rejects.toThrow('at most 1')
    expect(await database.count('projects')).toBe(0)
    await expect(database.list('projects', { limit: 101 })).rejects.toThrow('100')
    await expect(database.transaction(tx => tx.list('projects', { limit: 101 }))).rejects.toThrow('100')
    expect((await database.transaction(tx => tx.list('projects', { limit: 1000, requireComplete: true }))).records).toHaveLength(0)
    await expect(updateProjectStatus('missing', 'ongoing', creator, {}, database)).rejects.toMatchObject({ status: 404 })
  })
})
