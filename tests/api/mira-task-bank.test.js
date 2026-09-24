import { advanceMiraTaskBank, mergeMiraTaskPlan, recordMiraTaskOutcome, sanitizeMiraTaskBank } from '@/lib/miraTaskBank'
import { normalizePresenceUpdates } from '@/lib/chatPresence'

const draft = { type: 'create_meeting', fields: { title: 'Planning', invitees: ['Sahil'] } }
test('presence tolerates single, keyed, null and malformed payloads', () => {
  const row = { employeeId: 'abc', online: true }
  expect(normalizePresenceUpdates(row)).toEqual([row])
  expect(normalizePresenceUpdates({ abc: row })).toEqual([row])
  for (const value of [null, false, 'bad', 42, [null, 'bad'], {}]) expect(normalizePresenceUpdates(value)).toEqual([])
})
test('meeting fields survive clarification and unrelated replies', () => {
  let bank = mergeMiraTaskPlan(null, { draftAction: draft }, 'Arrange planning')
  bank = mergeMiraTaskPlan(bank, {}, 'What is the time?')
  bank = mergeMiraTaskPlan(bank, { draftAction: { type: 'create_meeting', fields: { scheduledStart: '2026-10-01T10:00:00Z' } } }, 'At ten')
  expect(bank.tasks[0].action.fields).toEqual({ ...draft.fields, scheduledStart: '2026-10-01T10:00:00Z' })
  expect(bank.tasks[0].status).not.toBe('completed')
})
test('queue advances only after real success and explicit confirmation', () => {
  let bank = mergeMiraTaskPlan(null, { taskPlan: [{ request: 'Meeting', action: draft }, { request: 'Image', action: { type: 'generate_image', fields: { prompt: 'A tree' } } }] }, 'Two tasks')
  expect(advanceMiraTaskBank(bank, 'next').tasks[0].status).not.toBe('completed')
  bank = recordMiraTaskOutcome(bank, { success: true, message: 'Created' })
  expect(bank.tasks[0].status).toBe('awaiting_confirmation')
  expect(advanceMiraTaskBank(bank, 'What time?').tasks[0].status).toBe('awaiting_confirmation')
  bank = advanceMiraTaskBank(bank, 'next')
  expect(bank.tasks[0].status).toBe('completed')
  bank = recordMiraTaskOutcome(bank, { success: true })
  expect(bank.tasks.every(task => task.status === 'completed')).toBe(true)
})
test('uncertain outcomes stay blocked until explicitly verified, and queue can be cleared', () => {
  let bank = mergeMiraTaskPlan(null, { draftAction: draft }, 'Meeting')
  bank = recordMiraTaskOutcome(bank, { success: false, uncertain: true })
  bank = mergeMiraTaskPlan(bank, { action: draft }, 'retry')
  expect(bank.tasks[0]).toMatchObject({ status: 'blocked', uncertain: true })
  expect(advanceMiraTaskBank(bank, 'next').tasks[0].uncertain).toBe(true)
  expect(advanceMiraTaskBank(bank, 'verified not completed, retry').tasks[0]).toMatchObject({ uncertain: false, status: 'pending' })
  expect(advanceMiraTaskBank(bank, 'clear task queue').tasks).toEqual([])
  expect(sanitizeMiraTaskBank({ tasks: [null] }).tasks).toEqual([])
})
