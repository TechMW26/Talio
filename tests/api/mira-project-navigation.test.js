import { prepareMiraAction } from '@/lib/miraActions'
import { miraNavigationPath, matchMiraProjectOpen } from '@/lib/miraNavigation'

const id = '507f1f77bcf86cd799439011'
const query = rows => ({ select() { return this }, sort() { return this }, limit() { return this }, lean: async () => rows })
test('named project commands and deep links are strictly internal', () => {
  expect(matchMiraProjectOpen('Open Talio launch project')).toEqual({ type: 'open_project', fields: { query: 'Talio launch' } })
  expect(matchMiraProjectOpen('Explain how to open a project')).toBeNull()
  expect(miraNavigationPath('projects', id)).toBe(`/dashboard/projects/${id}`)
  expect(miraNavigationPath('projects', '../settings')).toBeNull()
  expect(miraNavigationPath('https://evil.test', id)).toBeNull()
})
test('project lookup retains membership scope and returns an individual route ID', async () => {
  const models = { ProjectMember: { find: jest.fn(() => query([{ project: id }])) }, Project: { find: jest.fn(() => query([{ _id: id, name: 'Talio' }])) } }
  const result = await prepareMiraAction({ type: 'open_project', fields: { query: 'Talio' } }, { employeeId: 'own', role: 'employee' }, models)
  expect(result).toMatchObject({ path: 'navigate', page: 'projects', id })
  expect(models.Project.find.mock.calls[0][0].$and[0]).toEqual({ _id: { $in: [id] } })
})
test('existing project invitations preserve scoped target lookup', async () => {
  const models = { ProjectMember: { find: jest.fn(() => query([{ project: id }])) }, Project: { find: jest.fn(() => query([{ _id: id, name: 'Talio' }])) } }
  const result = await prepareMiraAction({ type: 'invite_project', fields: { query: 'Talio', invitees: ['me'] } }, { employeeId: 'own', role: 'employee' }, models)
  expect(result).toEqual({ path: '/api/projects/invite-existing', id, body: { memberIds: ['own'] } })
  expect(models.Project.find.mock.calls[0][0].$and[0]).toEqual({ _id: { $in: [id] } })
})
test('ambiguous matches require a DB-backed choice rather than guessing', async () => {
  const models = { Project: { find: jest.fn(() => query([{ _id: id, name: 'Talio' }, { _id: '507f1f77bcf86cd799439012', name: 'Talio' }])) } }
  await expect(prepareMiraAction({ type: 'open_project', fields: { query: 'Talio' } }, { employeeId: 'own', role: 'admin' }, models)).rejects.toMatchObject({ resolution: { kind: 'project', field: 'query', candidates: expect.arrayContaining([{ name: 'Talio', value: `project:${id}` }]) } })
})
