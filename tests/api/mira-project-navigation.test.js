import { prepareMiraAction } from '@/lib/miraActions'
import { miraNavigationPath, matchMiraProjectOpen } from '@/lib/miraNavigation'
import { getMiraResourceStore, getVisibleProjects } from '@/lib/platform/firestoreMiraResources.server'
jest.mock('@/lib/platform/firestoreMiraResources.server', () => ({ getMiraResourceStore: jest.fn(), getVisibleProjects: jest.fn() }))
jest.mock('@/lib/miraPeople', () => ({ resolveMiraPerson: async (_, user) => user.employeeId }))
const id = '507f1f77bcf86cd799439011', context = { databaseName: 'tenant' }, store = {}
beforeEach(() => { getMiraResourceStore.mockResolvedValue(store); getVisibleProjects.mockResolvedValue([{ _id: id, name: 'Talio' }]) })
test('named project commands and deep links stay internal', () => {
  expect(matchMiraProjectOpen('Open Talio launch project')).toEqual({ type: 'open_project', fields: { query: 'Talio launch' } })
  expect(matchMiraProjectOpen('Explain how to open a project')).toBeNull()
  expect(miraNavigationPath('projects', id)).toBe('/dashboard/projects/' + id)
  expect(miraNavigationPath('projects', '../settings')).toBeNull()
})
test('project lookup calls native scope helper', async () => {
  const user = { employeeId: 'own', role: 'employee' }
  expect(await prepareMiraAction({ type: 'open_project', fields: { query: 'Talio' } }, user, context)).toMatchObject({ path: 'navigate', id })
  expect(getVisibleProjects).toHaveBeenCalledWith(store, user, { search: 'Talio', id: undefined })
})
test('project invitations retain scoped identity', async () => {
  expect(await prepareMiraAction({ type: 'invite_project', fields: { query: 'Talio', invitees: ['me'] } }, { employeeId: 'own' }, context)).toEqual({ path: '/api/projects/invite-existing', id, body: { memberIds: ['own'] } })
})
test('ambiguous projects require a choice', async () => {
  getVisibleProjects.mockResolvedValue([{ _id: id, name: 'Talio' }, { _id: 'other', name: 'Talio' }])
  await expect(prepareMiraAction({ type: 'open_project', fields: { query: 'Talio' } }, { employeeId: 'own' }, context)).rejects.toMatchObject({ resolution: { kind: 'project' } })
})
