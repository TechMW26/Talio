import { prepareMiraAction } from '@/lib/miraActions'
import { matchMiraItemOpen, miraNavigationPath } from '@/lib/miraNavigation'
import { miraPlainCaption } from '@/lib/miraMessageDisplay'
import { validateMiraUiAction } from '@/lib/miraUiAction'

const id = '507f1f77bcf86cd799439011'
const chain = rows => ({ select() { return this }, sort() { return this }, limit() { return this }, lean: async () => rows })
test('task and meeting commands resolve without generative navigation', () => {
  expect(matchMiraItemOpen('Open white paper for X task')).toEqual({ type: 'open_task', fields: { query: 'white paper for X' } })
  expect(matchMiraItemOpen('Open meeting Delio feature testing')).toEqual({ type: 'open_meeting', fields: { query: 'Delio feature testing' } })
  expect(miraNavigationPath('tasks', id)).toBe(`/dashboard/projects/my-tasks?task=${id}`)
  expect(miraNavigationPath('tasks', '../secrets')).toBeNull()
})
test('meeting lookup is limited to organizer and invitee', async () => {
  const models = { Meeting: { find: jest.fn(() => chain([{ _id: id, title: 'Delio' }])) } }
  expect(await prepareMiraAction({ type: 'open_meeting', fields: { query: 'Delio' } }, { employeeId: 'own' }, models)).toMatchObject({ page: 'meetings', id })
  expect(models.Meeting.find.mock.calls[0][0].$and[0]).toEqual({ $or: [{ organizer: 'own' }, { 'invitees.employee': 'own' }] })
})
test('task lookup uses user assignments and retains ambiguity choices', async () => {
  const models = { TaskAssignee: { find: jest.fn(() => chain([{ task: id }])) }, Task: { find: jest.fn(() => chain([{ _id: id, title: 'Paper' }, { _id: '507f1f77bcf86cd799439012', title: 'Paper' }])) } }
  await expect(prepareMiraAction({ type: 'open_task', fields: { query: 'Paper' } }, { employeeId: 'own' }, models)).rejects.toMatchObject({ resolution: { kind: 'task' } })
  expect(models.Task.find.mock.calls[0][0].$and[0].$or[0]).toEqual({ _id: { $in: [id] } })
})
test('captions remove emphasis and UI actions reject scripts', () => {
  expect(miraPlainCaption('Open **Tasks** and __Meetings__.')).toBe('Open Tasks and Meetings.')
  expect(validateMiraUiAction({ type: 'ui_action', fields: { operation: 'eval', target: 'alert(1)' } })).toBeNull()
})
