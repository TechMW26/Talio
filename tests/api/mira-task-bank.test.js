import { advanceMiraTaskBank, mergeMiraTaskPlan, recordMiraTaskOutcome, sanitizeMiraTaskBank } from '@/lib/miraTaskBank'
import { normalizePresenceUpdates } from '@/lib/chatPresence'

const draft = { type: 'create_meeting', fields: { title: 'Planning', invitees: ['Sahil'] } }
const oldDesktop = { tasks: [{ id: 'old', request: 'Open WhatsApp and text Harshad Hi', action: { type: 'desktop_task', fields: {} }, status: 'blocked' }] }
test.each([
  "Uh, Mira, let's skip that task. Uh, first, check what Priyanka was doing at 11:00.",
  'Can you check what Priyanka Srivastava was doing at 11:00 a.m. today?',
  'Please show my meetings',
  'Cancel the previous task',
  'Clear pending tasks',
])('latest instruction displaces the stale desktop task: %s', message => {
  expect(advanceMiraTaskBank(oldDesktop, message).tasks).toEqual([])
})
test('new same-type request never inherits old recipients or fields', () => {
  const bank = mergeMiraTaskPlan({ tasks: [{ request: 'Create a meeting with Sahil', action: draft, status: 'awaiting_details' }] }, { action: { type: 'create_meeting', fields: { title: 'New meeting', invitees: ['Priyanka'] } } }, 'Create a new meeting with Priyanka')
  expect(bank.tasks[0].action.fields).toEqual({ title: 'New meeting', invitees: ['Priyanka'] })
})
test.each(['Harshit Patil', 'H-A-R-S-H-I-T', 'At 11 today', 'verified not completed, retry'])('clarifications retain the original task: %s', message => {
  expect(advanceMiraTaskBank(oldDesktop, message).tasks[0].id).toBe('old')
})
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
test('queue advances automatically only after real success', () => {
  let bank = mergeMiraTaskPlan(null, { taskPlan: [{ request: 'Meeting', action: draft }, { request: 'Image', action: { type: 'generate_image', fields: { prompt: 'A tree' } } }] }, 'Two tasks')
  expect(advanceMiraTaskBank(bank, 'next').tasks[0].status).not.toBe('completed')
  bank = recordMiraTaskOutcome(bank, { success: true, message: 'Created' })
  expect(bank.tasks[0].status).toBe('completed')
  expect(bank.tasks[1].status).toBe('pending')
  bank = recordMiraTaskOutcome(bank, { success: true })
  expect(bank.tasks.every(task => task.status === 'completed')).toBe(true)
})
test('legacy successful confirmation gates are completed without replay', () => {
  expect(advanceMiraTaskBank({ tasks: [{ request: 'Lookup', status: 'awaiting_confirmation' }] }, '').tasks[0].status).toBe('completed')
  expect(recordMiraTaskOutcome({ tasks: [{ status: 'pending' }] }, { success: true, uncertain: true }).tasks[0].status).toBe('blocked')
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
