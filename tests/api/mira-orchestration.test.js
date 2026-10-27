import { normalizeMiraTaskGraph, readyMiraTasks, nextMiraTask, miraOrchestrationContext } from '@/lib/miraOrchestration'
import { mergeMiraTaskPlan, recordMiraTaskOutcome, sanitizeMiraTaskBank, miraTaskActionMatches } from '@/lib/miraTaskBank'
const { createDesktopRun } = require('../../desktop-app/src/miraOrchestration')
const action = { type: 'create_task', fields: { title: 'Prepare notes' } }

test('dependency scheduler selects a prerequisite even when it is later in the graph', () => {
  const tasks = normalizeMiraTaskGraph([
    { id: 'invite', dependsOn: ['meeting'], status: 'pending' },
    { id: 'research', dependsOn: [], status: 'blocked' },
    { id: 'meeting', dependsOn: [], status: 'pending' },
  ])
  expect(nextMiraTask({ tasks }).id).toBe('meeting')
  tasks[2].status = 'completed'
  expect(readyMiraTasks({ tasks }).map(task => task.id)).toEqual(['invite'])
})
test.each([
  [{ id: 'a', dependsOn: ['a'] }],
  [{ id: 'a', dependsOn: ['missing'] }],
  [{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }],
  [{ id: 'a' }, { id: 'a' }],
].map(tasks => [tasks]))('invalid dependencies cannot silently unlock actions', tasks => {
  const normalized = normalizeMiraTaskGraph(tasks.map(task => ({ ...task, status: 'pending' })))
  expect(normalized.every(task => task.status === 'blocked')).toBe(true)
  expect(readyMiraTasks({ tasks: normalized })).toEqual([])
})
test('an uncertain write blocks dependent work while independent requested work stays ready', () => {
  let bank = mergeMiraTaskPlan(null, { taskPlan: [
    { id: 'create', request: 'Create notes', action },
    { id: 'invite', request: 'Share notes', dependsOn: ['create'], action: { type: 'send_message', fields: {} } },
    { id: 'other', request: 'Open Calculator', dependsOn: [], action: { type: 'desktop_task', fields: {} } },
  ] }, 'Create notes, share them and open Calculator')
  bank = recordMiraTaskOutcome(bank, { success: false, uncertain: true, message: 'Connection interrupted' })
  expect(nextMiraTask(bank).id).toBe('other')
  expect(readyMiraTasks(bank).map(task => task.id)).toEqual(['other'])
  bank = recordMiraTaskOutcome(bank, { success: true, verified: true, message: 'Calculator is open' })
  expect(bank.tasks.find(task => task.id === 'create').uncertain).toBe(true)
  expect(bank.tasks.find(task => task.id === 'other').status).toBe('completed')
})
test('execution receipts retain bounded resource references for dependent tasks', () => {
  const bank = recordMiraTaskOutcome({ tasks: [{ id: 'one', request: 'Create task', action, status: 'pending' }] }, {
    success: true, message: 'Created', resource: { id: 'task-123', type: 'task', secret: 'must not persist' },
  })
  expect(bank.tasks[0].reference).toEqual({ resource: { id: 'task-123', type: 'task' } })
  expect(miraOrchestrationContext(sanitizeMiraTaskBank(bank)).completed[0].reference.resource.id).toBe('task-123')
})
test('a successful input without verification is not a completed task', () => {
  const bank = recordMiraTaskOutcome({ tasks: [{ action, status: 'pending' }] }, { success: true, verified: false })
  expect(bank.tasks[0].status).toBe('blocked')
})
test('only a verified dependency can resolve a planned resource name to its exact typed ID', () => {
  const id = 'a'.repeat(24), bank = sanitizeMiraTaskBank({ tasks: [
    { id: 'project', request: 'Create Launch', status: 'completed', action: { type: 'create_project', fields: { name: 'Launch' } }, reference: { resource: { page: 'projects', id } } },
    { id: 'task', request: 'Create task in Launch', status: 'pending', dependsOn: ['project'], action: { type: 'create_task', fields: { title: 'Draft', project: 'Launch' } } },
  ] })
  const decision = { type: 'create_task', fields: { title: 'Draft', project: `project:${id}` } }
  expect(miraTaskActionMatches(bank.tasks[1], decision, 'task', bank)).toBe(true)
  expect(miraTaskActionMatches(bank.tasks[1], { ...decision, fields: { ...decision.fields, project: `project:${'b'.repeat(24)}` } }, 'task', bank)).toBe(false)
  bank.tasks[0].uncertain = true
  expect(miraTaskActionMatches(bank.tasks[1], decision, 'task', bank)).toBe(false)
})
test('a unique authorized lookup receipt can resolve a planned recipient without importing another contact', () => {
  const person = { name: 'Bob Smith', value: `employee:${'a'.repeat(24)}` }
  let bank = { tasks: [
    { id: 'lookup', request: 'Find Bob', status: 'pending', dependsOn: [], action: { type: 'lookup_people', fields: { query: 'Bob' } } },
    { id: 'send', request: 'Send Bob Hello', status: 'pending', dependsOn: ['lookup'], action: { type: 'send_message', fields: { recipient: 'Bob', content: 'Hello' } } },
  ] }
  bank = recordMiraTaskOutcome(bank, { success: true, resolution: { resolved: true, candidates: [person] } })
  bank = sanitizeMiraTaskBank(bank)
  expect(miraTaskActionMatches(bank.tasks[1], { type: 'send_message', fields: { recipient: person.value, content: 'Hello' } }, 'send', bank)).toBe(true)
  expect(miraTaskActionMatches(bank.tasks[1], { type: 'send_message', fields: { recipient: `employee:${'b'.repeat(24)}`, content: 'Hello' } }, 'send', bank)).toBe(false)
})
test('desktop coordinator detects repeated no-progress inputs and bounds recovery evidence', () => {
  const run = createDesktopRun(), click = { type: 'click', x: .2, y: .3 }
  run.observed(); run.executed({ type: 'batch', actions: [click, { type: 'type', text: 'hi' }] })
  expect(run.repeated(click, 'same-screen')).toBe(false)
  expect(run.repeated(click, 'same-screen')).toBe(true)
  for (let i = 0; i < 8; i++) run.failed(click, { message: 'Wrong app', uncertain: true })
  expect(run.context()).toMatchObject({ observations: 1, executedInputs: 2, recoveries: 8 })
  expect(run.context().recentFailures).toHaveLength(4)
})
