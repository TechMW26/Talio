import { ensurePendingResignationReminder } from '@/lib/hrms/resignationReminder.server'
import { workflowStore } from '../helpers/firestoreWorkflowStore'

const now = new Date('2026-10-28T03:30:00Z')
const request = (id, status, active = true) => ({ _id: id, employee: `emp-${id}`, status, active, updatedAt: new Date('2026-10-20') })
const person = id => ({ _id: `emp-${id}`, firstName: id, lastName: 'Test' })
const setup = requests => {
  const ids = requests.map(r => r._id)
  return { database: workflowStore(), resignationStore: workflowStore({ resignationrequests: requests, employees: ids.map(person) }) }
}
const cards = async database => (await database.list('actionablenotifications')).records

test('employees never get the HR resignation card', async () => {
  const { database, resignationStore } = setup([request('a', 'hr_review')])
  await ensurePendingResignationReminder({ database, resignationStore, user: { _id: 'u', role: 'employee' }, now })
  expect(await cards(database)).toHaveLength(0)
})

test('HR sees one daily card listing only resignations and exits that need HR', async () => {
  const { database, resignationStore } = setup([
    request('review', 'hr_review'), request('relay', 'hr_relay'), request('negotiate', 'negotiation_hr'),
    request('exit', 'accepted'), request('manager', 'hierarchy_review'), request('done', 'completed', false),
  ])
  const args = { database, resignationStore, user: { _id: 'hr', role: 'hr' }, now }
  await Promise.all([ensurePendingResignationReminder(args), ensurePendingResignationReminder(args)])
  const [card, ...rest] = await cards(database)
  expect(rest).toHaveLength(0)
  expect(card).toMatchObject({ user: 'hr', title: 'Pending resignations and exits (4)', url: '/dashboard/resignations?view=reviews', metadata: { reminderKey: 'resignation-pending:2026-10-28' } })
  expect(card.message).toContain('review Test — awaiting HR approval')
  expect(card.message).toContain('exit Test — exit / F&F pending')
  expect(card.message).not.toContain('manager Test')
  expect(card.message).not.toContain('done Test')
})

test('no card when nothing is pending', async () => {
  const { database, resignationStore } = setup([request('manager', 'hierarchy_review')])
  await ensurePendingResignationReminder({ database, resignationStore, user: { _id: 'hr', role: 'admin' }, now })
  expect(await cards(database)).toHaveLength(0)
})