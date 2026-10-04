jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/projectCollaboration.server', () => ({ projectContext: jest.fn(), projectHandler: fn => fn }))
jest.mock('@/lib/projectNotifications', () => ({}))
jest.mock('@/lib/projectEmailNotifications', () => ({}))
jest.mock('@/lib/actionableNotifications', () => ({}))
jest.mock('@/lib/actionableNotificationStore.server', () => ({}))
jest.mock('@/lib/realtimeEvents', () => ({}))
jest.mock('@/lib/eventBus', () => ({}))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { PROJECT_STORE_OPTIONS } from '@/lib/projects.server'
import { respondNativeAssignment, assignNativeTask, respondNativeDeletion } from '@/lib/taskActions.server'
import { mutateNativeSubtask } from '@/lib/taskSubtasks.server'
import { resolveNativeApproval } from '@/lib/projectApprovals.server'
jest.setTimeout(60000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('atomic task actions and review', () => {
  let firestore, database, actor, other
  const employee = 'aaaaaaaaaaaaaaaaaaaaaaaa', second = 'bbbbbbbbbbbbbbbbbbbbbbbb', project = 'cccccccccccccccccccccccc', taskId = 'dddddddddddddddddddddddd'
  beforeAll(() => { if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required'); firestore = new Firestore({ projectId: 'demo-talio-firestore' }) })
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: `test-task-actions-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, databaseName: 'talio_company_tasks', ...PROJECT_STORE_OPTIONS })
    actor = { _id: 'actor', role: 'employee', employeeId: employee, isActive: true }; other = { _id: 'other', role: 'employee', employeeId: second, isActive: true }
    for (const user of [actor, other]) { await database.create('users', user); await database.create('employees', { _id: user.employeeId, firstName: user._id, isActive: true }); await database.create('projectmembers', { _id: user._id, project, user: user.employeeId, invitationStatus: 'accepted' }) }
    await database.create('projects', { _id: project, name: 'Project', projectHead: 'head', createdBy: employee })
    await database.create('tasks', { _id: taskId, project, title: 'Task', status: 'todo', createdBy: employee, subtasks: [{ _id: 'subtask', title: 'Subtask', completed: false }] })
    await database.create('taskassignees', { _id: 'assignment', task: taskId, user: employee, assignmentStatus: 'pending' })
  })
  afterAll(async () => { await firestore?.terminate() })
  test('concurrent assignment responses are single use', async () => {
    const results = await Promise.allSettled(['accept', 'reject'].map(action => respondNativeAssignment(database, actor, taskId, project, { action })))
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(await database.count('projecttimelineevents')).toBe(1)
  })
  test('assignee validation rolls back all additions', async () => {
    await expect(assignNativeTask(database, actor, taskId, project, [second, 'eeeeeeeeeeeeeeeeeeeeeeee'])).rejects.toMatchObject({ status: 404 })
    expect(await database.count('taskassignees')).toBe(1)
  })
  test('multi-assignee completion waits for quorum and creates one review request', async () => {
    await respondNativeAssignment(database, actor, taskId, project, { action: 'accept' })
    await database.create('taskassignees', { _id: 'second-assignment', task: taskId, user: second, assignmentStatus: 'accepted' })
    const pending = await mutateNativeSubtask(database, actor, taskId, project, 'update', { subtaskId: 'subtask', completed: true })
    expect(pending.subtask.pendingAcceptance).toBe(true); expect(pending.task.progressPercentage).toBe(0)
    const results = await Promise.allSettled([1, 2].map(() => mutateNativeSubtask(database, other, taskId, project, 'update', { subtaskId: 'subtask', action: 'acceptCompletion' })))
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect((await database.get('tasks', taskId)).status).toBe('review')
    expect(await database.count('projectapprovalrequests')).toBe(1)
  })
  test('approval cannot change wrong-project task and preserves pending request', async () => {
    await database.mutate('users', actor._id, row => ({ ...row, role: 'admin' }))
    await database.create('projectapprovalrequests', { _id: 'review', project, relatedTask: taskId, status: 'pending', type: 'task_review' })
    await database.mutate('tasks', taskId, row => ({ ...row, project: 'different' }))
    await expect(resolveNativeApproval(database, actor, 'review', { action: 'approve' })).rejects.toMatchObject({ status: 404 })
    expect((await database.get('projectapprovalrequests', 'review')).status).toBe('pending')
  })
  test('concurrent approval is single use and deletion retains all source records', async () => {
    await database.mutate('users', actor._id, row => ({ ...row, role: 'admin' }))
    await database.create('projectapprovalrequests', { _id: 'review', project, relatedTask: taskId, status: 'pending', type: 'task_deletion' })
    const results = await Promise.allSettled([1, 2].map(() => resolveNativeApproval(database, actor, 'review', { action: 'approve' })))
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect((await database.get('tasks', taskId)).deletedAt).toBeTruthy()
    expect(await database.count('taskassignees')).toBe(1)
  })
  test('deactivated account cannot act using a previous auth snapshot', async () => {
    await database.mutate('users', actor._id, row => ({ ...row, isActive: false }))
    await expect(respondNativeAssignment(database, actor, taskId, project, { action: 'accept' })).rejects.toMatchObject({ status: 403 })
    expect((await database.get('taskassignees', 'assignment')).assignmentStatus).toBe('pending')
  })
})
