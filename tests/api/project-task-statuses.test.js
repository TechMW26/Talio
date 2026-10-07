jest.mock('@/lib/projectCollaboration.server', () => ({ projectContext: jest.fn(), projectHandler: fn => fn }))
jest.mock('@/lib/projectService', () => ({}))
jest.mock('@/lib/projectEmailNotifications', () => ({}))
jest.mock('@/lib/projectNotifications', () => ({}))
jest.mock('@/lib/realtimeEvents', () => ({}))
jest.mock('@/lib/hierarchyAuth', () => ({ hasDepartmentAuthority: () => false }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
import { mutateProjectDetails } from '@/lib/projectDetails.server'
import { updateNativeTask } from '@/lib/taskDetails.server'
import { DEFAULT_TASK_STATUSES, normalizeTaskStatuses } from '@/lib/taskStatusConfig'

const qa = { key: 'qa', label: 'QA', color: 'blue', isSystem: false }
const statuses = [...DEFAULT_TASK_STATUSES, qa]
function fixture(role = 'employee', head = true, used = true) {
  const actor = { _id: 'actor', employeeId: 'employee', role, isActive: true }
  const project = { _id: 'project', projectHead: head ? 'employee' : 'someone-else', taskStatuses: statuses }
  const task = { _id: 'task', project: 'project', title: 'Task', status: 'todo', createdBy: 'employee', subtasks: [] }
  const tx = {
    get: jest.fn(async table => table === 'users' ? actor : table === 'tasks' ? task : project),
    list: jest.fn(async table => ({ records: table === 'tasks' && used ? [{ _id: 'task', status: 'qa' }] : table === 'taskassignees' ? [{ user: 'employee', assignmentStatus: 'accepted' }] : [] })),
    replace: jest.fn(), create: jest.fn(),
  }
  return { actor, tx, database: { transaction: fn => fn(tx) } }
}

test('new same-label status never steals an existing key regardless of row order', async () => {
  const { actor, database } = fixture()
  const result = await mutateProjectDetails(database, actor, 'project', { taskStatuses: [...DEFAULT_TASK_STATUSES, { key: '', label: 'QA', color: 'green' }, qa] })
  expect(result.project.taskStatuses.slice(-2).map(s => s.key)).toEqual(['qa-2', 'qa'])
  expect(result.project.taskStatuses.at(-1)).toMatchObject({ key: 'qa', color: 'blue' })
})
test('renaming, recoloring and reordering preserves stored task references', () => {
  const rows = normalizeTaskStatuses([{ ...qa, label: 'Verification', color: 'pink' }, ...DEFAULT_TASK_STATUSES], statuses)
  expect(rows[0]).toMatchObject({ key: 'qa', label: 'Verification', color: 'pink', order: 0, isSystem: false })
})
test('new keys are unique and cannot silently reuse a removed key', () => {
  expect(normalizeTaskStatuses([...DEFAULT_TASK_STATUSES, { label: 'QA' }, { label: 'QA' }], statuses).slice(-2).map(s => s.key)).toEqual(['qa-2', 'qa-3'])
})
test.each([null, [], [null], [...DEFAULT_TASK_STATUSES, { label: 42 }], [...DEFAULT_TASK_STATUSES, qa, qa], [...DEFAULT_TASK_STATUSES, { label: 'Name', key: 'bad/key' }], Array(101).fill(qa)])('invalid status lists return a validation error: %#', value => {
  expect(() => normalizeTaskStatuses(value)).toThrow()
  try { normalizeTaskStatuses(value) } catch (error) { expect(error.status).toBe(400) }
})
test('built-ins cannot be removed or impersonated using client flags', () => {
  expect(() => normalizeTaskStatuses(DEFAULT_TASK_STATUSES.slice(1))).toThrow('built-in')
  expect(normalizeTaskStatuses([...DEFAULT_TASK_STATUSES, { ...qa, isSystem: true }]).at(-1).isSystem).toBe(false)
})
test('non-owner admins cannot manage statuses', async () => {
  const { actor, database, tx } = fixture('admin', false)
  await expect(mutateProjectDetails(database, actor, 'project', { taskStatuses: DEFAULT_TASK_STATUSES })).rejects.toMatchObject({ status: 403 })
  expect(tx.replace).not.toHaveBeenCalled()
})
test('used custom status cannot be deleted, including a same-label replacement', async () => {
  const { actor, database, tx } = fixture()
  await expect(mutateProjectDetails(database, actor, 'project', { taskStatuses: [...DEFAULT_TASK_STATUSES, { label: 'QA' }] })).rejects.toThrow('Move tasks off')
  expect(tx.replace).not.toHaveBeenCalled()
})
test('unused custom status can be removed', async () => {
  const { actor, database } = fixture('employee', true, false)
  expect((await mutateProjectDetails(database, actor, 'project', { taskStatuses: DEFAULT_TASK_STATUSES })).project.taskStatuses).toHaveLength(8)
})
test('task updates accept configured custom status and reject unknown keys', async () => {
  const { actor, database } = fixture()
  expect((await updateNativeTask(database, actor, 'task', 'project', { status: 'qa' })).task.status).toBe('qa')
  await expect(updateNativeTask(database, actor, 'task', 'project', { status: 'unknown' })).rejects.toThrow('Invalid task status')
})
test('accepted assignees still submit completion for review, not direct approval', async () => {
  const { actor, database } = fixture('employee', false)
  expect((await updateNativeTask(database, actor, 'task', 'project', { status: 'completed' })).task.status).toBe('review')
})
