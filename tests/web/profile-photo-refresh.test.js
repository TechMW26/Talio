import { patchProfilePhotoResponse } from '@/lib/client/profilePhoto'
import { getRefreshScopes, matchesApiRefreshScope } from '@/lib/clientDataSync'
import fs from 'fs'

test('patches employee dashboard photos immediately without discarding tasks or stats', () => {
  const before = { success: true, data: { employee: { _id: 'e1', profilePicture: 'old' }, taskStats: { total: 10 }, recentTasks: [{ _id: 'task' }] } }
  const after = patchProfilePhotoResponse(before, 'e1', 'new?v=2')
  expect(after.data.employee.profilePicture).toBe('new?v=2')
  expect(after.data.taskStats).toBe(before.data.taskStats)
  expect(after.data.recentTasks).toBe(before.data.recentTasks)
  expect(before.data.employee.profilePicture).toBe('old')
})
test('updates profile, user and directory records but not other employees', () => {
  const response = { data: { employee: { _id: 'e1' }, user: { _id: 'u1', employeeId: { _id: 'e1' } }, members: [{ _id: 'e1', profilePicture: 'old' }, { _id: 'e2', profilePicture: 'keep' }] } }
  const after = patchProfilePhotoResponse(response, 'e1', 'new')
  expect(after.data.user.employeeId.profilePicture).toBe('new')
  expect(after.data.user.profilePicture).toBe('new')
  expect(after.data.members[0].profilePicture).toBe('new')
  expect(after.data.members[1]).toBe(response.data.members[1])
  expect(patchProfilePhotoResponse({ data: [{ _id: 'e1' }] }, 'e1', 'new').data[0].profilePicture).toBe('new')
  expect(patchProfilePhotoResponse(undefined, 'e1', 'new')).toBeUndefined()
})
test.each(['PUT /api/employees/e1', 'realtime:employee-updated'])('employee changes refresh team and own profiles: %s', source => {
  const scopes = getRefreshScopes(source)
  expect(matchesApiRefreshScope('/api/team/members/e1', scopes)).toBe(true)
  expect(matchesApiRefreshScope('/api/profile', scopes)).toBe(true)
  expect(matchesApiRefreshScope('/api/payroll', scopes)).toBe(false)
})
test('upload preserves source pixels and publishes photo and viewport updates to cached detail views', () => {
  const source = fs.readFileSync('app/dashboard/profile/page.js', 'utf8')
  expect(source).not.toContain('ctx.arc(')
  expect(source).not.toContain('ctx.clip()')
  expect(source).not.toContain('getCroppedImage')
  expect(source).not.toContain('toDataURL')
  expect(source).toContain('profilePicture: originalImage, profilePictureViewport: photoViewport')
  expect(source).toContain('patchProfilePhotoResponse(cached, employee._id, profilePictureUrl, photoViewport)')
  expect(source).toContain('broadcastUserUpdate(parsedUser)')
  const member = fs.readFileSync('app/dashboard/team/members/[id]/page.js', 'utf8')
  expect(member).toContain("window.addEventListener('talio:user-updated', onUpdate)")
  expect(member).toContain("window.addEventListener('storage', onStorage)")
})

test('viewport metadata refreshes nested employee and user records together', () => {
  const viewport = { scale: 2, x: 20 }
  const result = patchProfilePhotoResponse({ data: { user: { _id: 'u', employeeId: { _id: 'e' } }, employee: { _id: 'e' } } }, 'e', 'original', viewport)
  expect(result.data.employee.profilePictureViewport).toEqual(viewport)
  expect(result.data.user.employeeId.profilePictureViewport).toEqual(viewport)
})
