import { getReportingParent, syncReportingManager } from '@/lib/employeeReporting'

describe('consistent employee reporting relationships', () => {
  test('uses saved manager rather than executive escalation or a different assigned manager', () => {
    expect(getReportingParent({ reportingManager: { _id: 'jaya' }, assignedManager: 'other', reportsTo: 'director' })).toBe('jaya')
  })
  test('supports direct reporting without a team lead', () => {
    const update = { assignedManager: 'manager', assignedTeamLead: null, reportsTo: 'director' }
    syncReportingManager(update)
    expect(update.reportingManager).toBe('manager')
    expect(getReportingParent(update)).toBe('manager')
  })
  test('retains the nearest lead for legacy records without a direct manager', () => {
    expect(getReportingParent({ assignedTeamLead: 'lead', assignedManager: 'manager' })).toBe('lead')
  })
  test('clearing a lead reroutes to the existing manager, not a stale direct manager', () => {
    const update = { assignedTeamLead: null }
    syncReportingManager(update, { assignedTeamLead: 'lead', assignedManager: 'manager', reportingManager: 'lead' })
    expect(update.reportingManager).toBe('manager')
  })
  test('clearing all assignments removes stale workflow routing', () => {
    const update = { assignedTeamLead: null, assignedManager: null, reportsTo: null }
    syncReportingManager(update, { reportingManager: 'old-manager' })
    expect(update.reportingManager).toBeNull()
  })
  test('unrelated edits preserve the reporting relationship', () => {
    const update = { phone: '123' }
    syncReportingManager(update, { reportingManager: 'manager' })
    expect(update).not.toHaveProperty('reportingManager')
  })
  test('explicit direct manager is authoritative', () => {
    const update = { reportingManager: 'direct', assignedManager: 'other' }
    syncReportingManager(update)
    expect(update.reportingManager).toBe('direct')
  })
  test('does not infer a manager from designation or department', () => {
    expect(getReportingParent({ designationLevel: 2, department: 'HR' })).toBeNull()
  })
})
