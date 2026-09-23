import { miraTaskLink } from '@/lib/miraTaskLink'

const id = 'abcdef123456abcdef123456'
const projectId = '123456abcdef123456abcdef'
test('links to a project task or a standalone task by its exact ID', () => {
  expect(miraTaskLink({ id, projectId })).toBe(`/dashboard/projects/${projectId}?task=${id}`)
  expect(miraTaskLink({ id })).toBe(`/dashboard/projects/my-tasks?task=${id}`)
  expect(miraTaskLink({ _id: id })).toBe(`/dashboard/projects/my-tasks?task=${id}`)
})
test('rejects malformed task identifiers instead of generating unsafe routes', () => {
  expect(miraTaskLink({ id: '../../settings' })).toBe('/dashboard/projects/my-tasks')
  expect(miraTaskLink({ id, projectId: '../settings' })).toBe(`/dashboard/projects/my-tasks?task=${id}`)
})
