jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { prepareMiraAction } from '@/lib/miraActions'

const own = 'aaaaaaaaaaaaaaaaaaaaaaaa', report = 'bbbbbbbbbbbbbbbbbbbbbbbb', foreign = 'cccccccccccccccccccccccc'
const p1 = '111111111111111111111111', p2 = '222222222222222222222222', p3 = '333333333333333333333333'
const t1 = '444444444444444444444444', t2 = '555555555555555555555555', t3 = '666666666666666666666666'
const context = { databaseName: 'talio_company_A' }, actor = { _id: 'user-A', employeeId: own, role: 'employee' }
let stores, store
function memoryStore() {
  const rows = new Map(), key = (collection, id) => `${collection}:${id}`
  const db = {
    seed(collection, row) { rows.set(key(collection, row._id), structuredClone(row)) },
    remove(collection, id) { rows.delete(key(collection, id)) },
    get: jest.fn(async (collection, id) => structuredClone(rows.get(key(collection, id)) || null)),
    getMany: jest.fn(async (collection, ids) => ids.map(id => structuredClone(rows.get(key(collection, id)) || null))),
    list: jest.fn(async (collection, { filters = [] } = {}) => ({ records: [...rows.entries()]
      .filter(([id]) => id.startsWith(`${collection}:`)).map(([, row]) => row)
      .filter(row => filters.every(({ field, operator, value }) => operator === '==' ? row[field] === value
        : operator === 'in' ? value.includes(row[field]) : operator === 'array-contains' ? row[field]?.includes(value) : false))
      .map(row => structuredClone(row)), nextCursor: null })),
  }
  db.seed('employees', { _id: own, status: 'active', firstName: 'Self' })
  db.seed('employees', { _id: report, status: 'active', firstName: 'Report', reportingManager: own })
  return db
}
const createTask = project => prepareMiraAction({ type: 'create_task', fields: { title: 'Review', assignees: ['me'], project } }, actor, context)
const assignTask = (taskTitle, user = actor) => prepareMiraAction({ type: 'assign_task', fields: { taskTitle, assignees: ['me'] } }, user, context)
beforeEach(() => {
  jest.clearAllMocks(); stores = { talio_company_A: memoryStore(), talio_company_B: memoryStore() }; store = stores.talio_company_A
  getFirestoreTenantDatabase.mockImplementation(async name => { if (!stores[name]) throw new Error('Wrong tenant'); return stores[name] })
})

test('a verified project reference selects the exact visible project among duplicate names', async () => {
  for (const id of [p1, p2]) store.seed('projects', { _id: id, name: 'Launch', createdBy: own, searchGrams: ['lau'] })
  expect(await createTask(`project:${p2}`)).toMatchObject({ path: '/api/tasks/create', body: { projectId: p2 } })
  expect(store.getMany).toHaveBeenCalledWith('projects', [p2])
  expect(store.list.mock.calls.some(([collection]) => collection === 'projects')).toBe(false)
  await expect(createTask('Launch')).rejects.toThrow('unique project')
})

test('legacy exact project names still work with the existing case-insensitive matching', async () => {
  store.seed('projects', { _id: p1, name: 'Launch', createdBy: own, searchGrams: ['lau'] })
  expect(await createTask('launch')).toMatchObject({ body: { projectId: p1 } })
})

test('an explicit project reference cannot bypass accepted membership or task-creation scope', async () => {
  store.seed('projects', { _id: p3, name: 'Private launch', createdBy: foreign, department: 'department-A' })
  store.seed('projectmembers', { _id: 'pending', project: p3, user: own, invitationStatus: 'pending' })
  await expect(prepareMiraAction({ type: 'create_task', fields: { title: 'Review', project: `project:${p3}` } }, { ...actor, headOfDepartments: ['department-A'] }, context)).rejects.toThrow('unique project')
  store.seed('projectmembers', { _id: 'pending', project: p3, user: own, invitationStatus: 'accepted' })
  expect(await createTask(`project:${p3}`)).toMatchObject({ body: { projectId: p3 } })
})

test('project references retain the existing assignee membership check', async () => {
  store.seed('projects', { _id: p1, name: 'Launch', createdBy: own })
  const action = { type: 'create_task', fields: { title: 'Review', project: `project:${p1}`, assignees: [`employee:${report}`] } }
  await expect(prepareMiraAction(action, actor, context)).rejects.toThrow('not members of that project')
  store.seed('projectmembers', { _id: 'report-member', project: p1, user: report, invitationStatus: 'accepted' })
  expect(await prepareMiraAction(action, actor, context)).toMatchObject({ body: { projectId: p1, assigneeIds: [report] } })
})

test('a task reference disambiguates duplicate standalone titles through assignOnly visibility', async () => {
  for (const id of [t1, t2]) store.seed('tasks', { _id: id, title: 'Draft', createdBy: own, searchGrams: ['dra'] })
  expect(await assignTask(`task:${t2}`)).toMatchObject({ path: '/api/tasks/assign-existing', id: t2 })
  expect(store.getMany).toHaveBeenCalledWith('tasks', [t2])
  await expect(assignTask('Draft')).rejects.toThrow('unique standalone task')
})

test('legacy exact standalone task names still work', async () => {
  store.seed('tasks', { _id: t1, title: 'Draft', assignedBy: own, searchGrams: ['dra'] })
  expect(await assignTask('Draft')).toMatchObject({ id: t1 })
})

test('being an assignee does not let a reference bypass task assignment authority', async () => {
  store.seed('tasks', { _id: t3, title: 'Private', createdBy: foreign })
  store.seed('taskassignees', { _id: 'assigned', user: own, task: t3, assignmentStatus: 'accepted' })
  await expect(assignTask(`task:${t3}`)).rejects.toThrow('unique standalone task')
})

test.each(['employee', 'admin'])('project task references still require the project page for %s', async role => {
  store.seed('tasks', { _id: t1, title: 'Project draft', createdBy: own, project: p1 })
  await expect(assignTask(`task:${t1}`, { ...actor, role })).rejects.toThrow('Project task assignments must use the project page')
})

test('references from a different tenant never reach that tenant store', async () => {
  stores.talio_company_B.seed('projects', { _id: p3, name: 'Foreign launch', createdBy: own })
  stores.talio_company_B.seed('tasks', { _id: t3, title: 'Foreign draft', createdBy: own })
  await expect(createTask(`project:${p3}`)).rejects.toThrow('unique project')
  await expect(assignTask(`task:${t3}`)).rejects.toThrow('unique standalone task')
  expect(stores.talio_company_B.getMany).not.toHaveBeenCalled()
  expect(getFirestoreTenantDatabase.mock.calls.every(([name]) => name === context.databaseName)).toBe(true)
})

test('bare or wrongly typed IDs are not treated as privileged resource references', async () => {
  store.seed('projects', { _id: p1, name: 'Launch', createdBy: own })
  store.seed('tasks', { _id: t1, title: 'Draft', createdBy: own })
  await expect(createTask(p1)).rejects.toThrow('unique project')
  await expect(createTask(`task:${p1}`)).rejects.toThrow('unique project')
  await expect(assignTask(`project:${t1}`)).rejects.toThrow('unique standalone task')
  expect(store.getMany.mock.calls.some(([collection]) => ['projects', 'tasks'].includes(collection))).toBe(false)
})
