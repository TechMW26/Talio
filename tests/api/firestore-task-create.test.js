jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/projectCollaboration.server', () => ({ projectContext: jest.fn() }))
jest.mock('@/lib/projectNotifications', () => ({ notifyTaskAssigned: jest.fn(), getProjectMemberUserIds: jest.fn() }))
jest.mock('@/lib/projectEmailNotifications', () => ({ queueTaskCreatedEmailNotifications: jest.fn() }))
jest.mock('@/lib/actionableNotifications', () => ({ createTaskAssignmentNotification: jest.fn() }))
jest.mock('@/lib/actionableNotificationStore.server', () => ({ getActionableDatabase: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitTaskUpdate: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { PROJECT_STORE_OPTIONS } from '@/lib/projects.server'
import { createNativeTask, taskInput } from '@/lib/tasks.server'
jest.setTimeout(60000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
test('task input rejects invalid dates, attachments and estimates', () => {
  expect(() => taskInput({ title: 'Task', startDate: 'invalid' }, 'employee')).toThrow('date')
  expect(() => taskInput({ title: 'Task', estimatedHours: -1 }, 'employee')).toThrow('estimated')
  expect(() => taskInput({ title: 'Task', attachments: [{ name: 'bad', url: 'javascript:bad()' }] }, 'employee')).toThrow('attachment')
})
emulator('native task creation', () => {
  let firestore, database, actor
  const employeeId = 'aaaaaaaaaaaaaaaaaaaaaaaa', assignee = 'bbbbbbbbbbbbbbbbbbbbbbbb', project = 'cccccccccccccccccccccccc'
  beforeAll(() => { if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required'); firestore = new Firestore({ projectId: 'demo-talio-firestore' }) })
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: `test-task-create-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, databaseName: 'talio_company_tasks', ...PROJECT_STORE_OPTIONS })
    actor = { _id: 'dddddddddddddddddddddddd', role: 'employee', employeeId, isActive: true }
    await database.create('users', actor)
    await database.create('employees', { _id: employeeId, firstName: 'Creator', isActive: true })
    await database.create('employees', { _id: assignee, firstName: 'Assignee', isActive: true })
    await database.create('projects', { _id: project, name: 'Project', createdBy: employeeId })
    await database.create('projectmembers', { _id: 'creator-member', project, user: employeeId, invitationStatus: 'accepted' })
  })
  afterAll(async () => { await firestore?.terminate() })
  test('invalid or unaccepted assignees cannot leave orphan tasks', async () => {
    await expect(createNativeTask(database, actor, { title: 'Task', assigneeIds: [assignee] }, project)).rejects.toMatchObject({ status: 409 })
    expect(await database.count('tasks')).toBe(0)
    expect(await database.count('projecttimelineevents')).toBe(0)
  })
  test('concurrent tasks get distinct project order and atomic assignments', async () => {
    await database.create('projectmembers', { _id: 'assignee-member', project, user: assignee, invitationStatus: 'accepted' })
    const results = await Promise.all(['First', 'Second'].map(title => createNativeTask(database, actor, { title, assigneeIds: [employeeId, assignee] }, project)))
    expect(new Set(results.map(result => result.task.order)).size).toBe(2)
    expect(await database.count('tasks')).toBe(2)
    expect(await database.count('taskassignees')).toBe(4)
    expect(await database.count('projecttimelineevents')).toBe(6)
  })
  test('current account and membership are rechecked rather than trusting an old auth snapshot', async () => {
    await database.mutate('projectmembers', 'creator-member', current => ({ ...current, invitationStatus: 'rejected' }))
    await expect(createNativeTask(database, actor, { title: 'Denied', assigneeIds: [employeeId] }, project)).rejects.toMatchObject({ status: 403 })
    await database.mutate('users', actor._id, current => ({ ...current, isActive: false }))
    await expect(createNativeTask(database, actor, { title: 'Denied', assigneeIds: [employeeId] })).rejects.toMatchObject({ status: 403 })
    expect(await database.count('tasks')).toBe(0)
  })
})
