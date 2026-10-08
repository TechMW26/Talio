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
