import { canViewTenantScreenshots } from '@/lib/productivityPermissions'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
let target, departments
beforeEach(() => {
  target = { _id: 'targetEmployee' }; departments = []
  getFirestoreTenantDatabase.mockResolvedValue({ getMany: async collection => collection === 'users' ? [{ employeeId: 'managerEmployee' }, { employeeId: 'targetEmployee' }] : collection === 'employees' ? [{ _id: 'managerEmployee' }, target] : departments })
})
test('manager title alone does not grant access to unrelated screenshots', async () => {
  target.department = 'other'
  expect(await canViewTenantScreenshots('viewer', 'target', 'manager', 'tenant')).toBe(false)
})
test.each(['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager'])('allows an actual direct report through %s', async field => {
  target[field] = 'managerEmployee'
  expect(await canViewTenantScreenshots('viewer', 'target', 'manager', 'tenant')).toBe(true)
})
test('department heads are checked against the target department', async () => {
  target.department = 'dept'; departments = [{ _id: 'dept', head: 'managerEmployee' }]
  expect(await canViewTenantScreenshots('viewer', 'target', 'employee', 'tenant')).toBe(true)
  expect(getFirestoreTenantDatabase).toHaveBeenCalledWith('tenant')
})
