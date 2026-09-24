import { canViewUserScreenshots } from '@/lib/productivityPermissions'

function models(targetEmployee = {}) {
  return {
    User: { findById: id => ({ select: async () => ({ employeeId: id === 'viewer' ? 'managerEmployee' : 'targetEmployee' }) }) },
    Employee: { findById: id => ({ select: async () => id === 'managerEmployee' ? { _id: id } : targetEmployee }) },
    Department: { find: jest.fn(() => ({ select: async () => [] })) },
  }
}
test('manager title alone does not grant access to unrelated screenshots', async () => {
  expect(await canViewUserScreenshots('viewer', 'target', 'manager', models({ department: 'other' }))).toBe(false)
})
test.each(['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager'])('allows an actual direct report through %s', async field => {
  expect(await canViewUserScreenshots('viewer', 'target', 'manager', models({ [field]: 'managerEmployee' }))).toBe(true)
})
test('department heads are checked against the target department', async () => {
  const data = models({ department: 'dept' })
  data.Department.find.mockReturnValue({ select: async () => [{ _id: 'dept' }] })
  expect(await canViewUserScreenshots('viewer', 'target', 'employee', data)).toBe(true)
  expect(data.Department.find).toHaveBeenCalledWith({ _id: { $in: ['dept'] }, $or: [{ head: 'managerEmployee' }, { heads: 'managerEmployee' }] })
})
