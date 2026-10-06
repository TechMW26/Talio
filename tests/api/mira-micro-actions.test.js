import { prepareMiraAction } from '@/lib/miraActions'
import { matchMiraItemOpen, miraNavigationPath } from '@/lib/miraNavigation'
import { miraPlainCaption } from '@/lib/miraMessageDisplay'
import { validateMiraUiAction } from '@/lib/miraUiAction'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))

const id = '507f1f77bcf86cd799439011'
const context = { databaseName: 'talio_company_test' }
const database = records => {
  const store = { get: jest.fn(async (collection, id) => collection === 'employees' && id === 'own' ? { _id: id } : null), list: jest.fn(async collection => ({ records: records[collection] || [], nextCursor: null })) }
  getFirestoreTenantDatabase.mockResolvedValue(store)
  return store
}
test('task and meeting commands resolve without generative navigation', () => {
  expect(matchMiraItemOpen('Open white paper for X task')).toEqual({ type: 'open_task', fields: { query: 'white paper for X' } })
  expect(matchMiraItemOpen('Open meeting Delio feature testing')).toEqual({ type: 'open_meeting', fields: { query: 'Delio feature testing' } })
  expect(miraNavigationPath('tasks', id)).toBe(`/dashboard/projects/my-tasks?task=${id}`)
  expect(miraNavigationPath('tasks', '../secrets')).toBeNull()
})
test('meeting lookup is limited to organizer and invitee', async () => {
  const store = database({ meetings: [{ _id: id, title: 'Delio', organizer: 'own' }, { _id: 'foreign', title: 'Delio', organizer: 'someone-else', invitees: [] }] })
  expect(await prepareMiraAction({ type: 'open_meeting', fields: { query: 'Delio' } }, { employeeId: 'own' }, context)).toMatchObject({ page: 'meetings', id })
  expect(store.list).toHaveBeenCalledWith('meetings', expect.objectContaining({ filters: [{ field: 'searchGrams', operator: 'array-contains', value: 'del' }] }))
  expect(getFirestoreTenantDatabase).toHaveBeenCalledWith(context.databaseName, expect.any(Object))
})
test('existing meeting invitations resolve the meeting and recipient before delegating', async () => {
  database({ meetings: [{ _id: id, title: 'Delio', organizer: 'own' }] })
  const prepared = await prepareMiraAction({ type: 'invite_meeting', fields: { query: 'Delio', invitees: ['me'] } }, { employeeId: 'own' }, context)
  expect(prepared).toEqual({ path: '/api/meetings/invite-existing', id, method: 'PUT', body: { addInvitees: ['own'] } })
})
test('task lookup uses user assignments and retains ambiguity choices', async () => {
  const store = database({ taskassignees: [{ task: id }], tasks: [{ _id: id, title: 'Paper' }, { _id: '507f1f77bcf86cd799439012', title: 'Paper', createdBy: 'own' }, { _id: 'foreign', title: 'Paper', createdBy: 'someone-else' }] })
  await expect(prepareMiraAction({ type: 'open_task', fields: { query: 'Paper' } }, { employeeId: 'own' }, context)).rejects.toMatchObject({ resolution: { kind: 'task', candidates: [{ name: 'Paper', value: 'task:' + id }, { name: 'Paper', value: 'task:507f1f77bcf86cd799439012' }] } })
  expect(store.list).toHaveBeenCalledWith('taskassignees', expect.objectContaining({ filters: expect.arrayContaining([{ field: 'user', operator: '==', value: 'own' }]) }))
})
test('captions remove emphasis and UI actions reject scripts', () => {
  expect(miraPlainCaption('Open **Tasks** and __Meetings__.')).toBe('Open Tasks and Meetings.')
  expect(validateMiraUiAction({ type: 'ui_action', fields: { operation: 'eval', target: 'alert(1)' } })).toBeNull()
})
