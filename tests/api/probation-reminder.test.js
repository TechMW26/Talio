import { ensureProbationReviewReminder } from '@/lib/hrms/probationReminder.server'
import { workflowStore } from '../helpers/firestoreWorkflowStore'

test('does not generate HR reminders for employees', async () => {
  await ensureProbationReviewReminder({ database: {}, user: { role: 'employee' } })
})
test('creates one daily review list atomically and preserves imported daily records', async () => {
  const database = workflowStore({ employees: [{ _id: 'employee', status: 'active', firstName: 'Test', lastName: 'Employee', lifecycle: { probation: { applicable: true, status: 'in_progress', reviewDate: new Date('2026-09-28') } } }] })
  const args = { database, user: { _id: 'hr', role: 'hr' }, now: new Date('2026-09-25T12:00:00Z') }
  await Promise.all([ensureProbationReviewReminder(args), ensureProbationReviewReminder(args)])
  expect(await database.count('actionablenotifications')).toBe(1)
  expect((await database.list('actionablenotifications')).records[0]).toMatchObject({ user: 'hr', type: 'generic', url: '/dashboard/employees', metadata: { reminderKey: 'probation-review:2026-09-25' } })
})
test('an existing daily reminder skips all employee reads', async () => {
  const database = { get: jest.fn(async()=>({_id:'delivered'})), list:jest.fn(), transaction:jest.fn() }
  await ensureProbationReviewReminder({database,user:{_id:'hr',role:'hr'},now:new Date('2026-09-25T12:00:00Z')})
  expect(database.get).toHaveBeenCalledTimes(1)
  expect(database.list).not.toHaveBeenCalled()
  expect(database.transaction).not.toHaveBeenCalled()
})

const employee = (id, status, reviewDate) => ({ _id: id, status: 'active', firstName: id, lastName: 'Test', lifecycle: { probation: { applicable: true, status, reviewDate: new Date(reviewDate) } } })
const reminderFor = async employees => {
  const database = workflowStore({ employees })
  await ensureProbationReviewReminder({ database, user: { _id: 'hr', role: 'hr' }, now: new Date('2026-10-28T03:30:00Z') })
  return (await database.list('actionablenotifications')).records[0]
}
test('lists probations ending this week and recently overdue, not staff from a year ago', async () => {
  const reminder = await reminderFor([
    employee('dueSoon', 'in_progress', '2026-11-02'),
    employee('endedToday', 'in_progress', '2026-10-28'),
    employee('overdue', 'in_progress', '2026-10-10'),
    employee('yearOld', 'in_progress', '2025-10-20'),
    employee('nextMonth', 'in_progress', '2026-12-01'),
  ])
  expect(reminder.message).toContain('dueSoon')
  expect(reminder.message).toContain('endedToday')
  expect(reminder.message).toContain('overdue')
  expect(reminder.message).not.toContain('yearOld')
  expect(reminder.message).not.toContain('nextMonth')
})
test('an extended probation is reminded on its new end date and labelled', async () => {
  const reminder = await reminderFor([employee('extendedOne', 'extended', '2026-10-28')])
  expect(reminder.message).toContain('extendedOne Test — 2026-10-28 (extended)')
})
test('confirmed probations are never listed', async () => {
  expect(await reminderFor([employee('confirmedOne', 'confirmed', '2026-10-28')])).toBeUndefined()
})
test('the daily key follows the IST morning, not the UTC date', async () => {
  const database = workflowStore({ employees: [employee('a', 'in_progress', '2026-10-28')] })
  await ensureProbationReviewReminder({ database, user: { _id: 'hr', role: 'hr' }, now: new Date('2026-10-27T20:00:00Z') })
  expect((await database.list('actionablenotifications')).records[0].metadata.reminderKey).toBe('probation-review:2026-10-28')
})
