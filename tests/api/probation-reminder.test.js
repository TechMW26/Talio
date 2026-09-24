import { ensureProbationReviewReminder } from '@/lib/hrms/probationReminder.server'

test('does not generate HR reminders for employees', async () => {
  await ensureProbationReviewReminder({ models: {}, user: { role: 'employee' } })
})
test('creates one daily review list using an upsert', async () => {
  const query = { select: () => query, sort: () => query, limit: () => query, lean: async () => [{ firstName: 'Test', lastName: 'Employee', lifecycle: { probation: { reviewDate: '2026-09-28' } } }] }
  const models = { Employee: { find: jest.fn(() => query) }, ActionableNotification: { findOneAndUpdate: jest.fn() } }
  await ensureProbationReviewReminder({ models, user: { _id: 'hr', role: 'hr' }, now: new Date('2026-09-25T12:00:00Z') })
  expect(models.ActionableNotification.findOneAndUpdate).toHaveBeenCalledWith({ user: 'hr', 'metadata.reminderKey': 'probation-review:2026-09-25' }, expect.objectContaining({ $setOnInsert: expect.objectContaining({ type: 'generic', url: '/dashboard/employees' }) }), { upsert: true, setDefaultsOnInsert: true })
})
