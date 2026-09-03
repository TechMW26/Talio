import fs from 'node:fs'
import path from 'node:path'
import {
  getProbationApproverCandidates,
  requireDecisionRemarks,
  resolveProbationApprover,
  validateProbationApprovalRequest,
} from '@/lib/hrms/probationApproval.server'

describe('probation approval workflow', () => {
  const ids = {
    employee: '66c000000000000000000001',
    reporting: '66c000000000000000000002',
    teamLead: '66c000000000000000000003',
    manager: '66c000000000000000000004',
    executive: '66c000000000000000000005',
  }

  test('resolves the first active linked account in reporting priority order', () => {
    const employee = {
      _id: ids.employee,
      reportingManager: ids.reporting,
      assignedTeamLead: ids.teamLead,
      assignedManager: ids.manager,
      reportsTo: ids.executive,
    }
    const users = [
      { _id: '76c000000000000000000001', employeeId: ids.reporting, isActive: false },
      { _id: '76c000000000000000000002', employeeId: ids.teamLead, isActive: true },
      { _id: '76c000000000000000000003', employeeId: ids.manager, isActive: true },
    ]

    expect(resolveProbationApprover(employee, users)).toMatchObject({
      employeeId: ids.teamLead,
      userId: '76c000000000000000000002',
      source: 'assignedTeamLead',
    })
  })

  test('deduplicates hierarchy edges and never routes an employee to themselves', () => {
    expect(getProbationApproverCandidates({
      _id: ids.employee,
      reportingManager: ids.employee,
      assignedTeamLead: ids.teamLead,
      assignedManager: ids.teamLead,
      reportsTo: ids.executive,
    })).toEqual([
      { employeeId: ids.teamLead, source: 'assignedTeamLead' },
      { employeeId: ids.executive, source: 'reportsTo' },
    ])
  })

  test('requires extension rationale and manager decision remarks', () => {
    expect(() => validateProbationApprovalRequest({ requestType: 'extension', months: 2 })).toThrow('reason')
    expect(validateProbationApprovalRequest({ requestType: 'extension', months: 2, remarks: 'More observation is needed' })).toEqual({
      requestType: 'extension', extensionMonths: 2, requestRemarks: 'More observation is needed',
    })
    expect(() => requireDecisionRemarks('   ')).toThrow('Manager remarks')
    expect(requireDecisionRemarks(' Goals achieved ')).toBe('Goals achieved')
  })

  test('uses a durable tenant record, scoped approver authorization, and non-dismissible prompt', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'app/api/employees/[id]/probation-approval/route.js'), 'utf8')
    const tenantModels = fs.readFileSync(path.join(process.cwd(), 'lib/tenantModels.js'), 'utf8')
    const notifications = fs.readFileSync(path.join(process.cwd(), 'lib/actionableNotifications.js'), 'utf8')

    expect(tenantModels).toContain('ProbationApproval: ProbationApprovalSchema')
    expect(route).toContain("approverUser: userId(auth.user), status: 'pending'")
    expect(route).toContain("status: { $in: ['pending', 'processing'] }")
    expect(notifications).toContain("dismissible: false")
    expect(notifications).toContain("requiresReason: true")
  })

  test('employee profile exposes approval history and cannot bypass manager approval', () => {
    const lifecycleRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/employees/[id]/lifecycle/route.js'), 'utf8')
    const panel = fs.readFileSync(path.join(process.cwd(), 'components/employees/EmployeeLifecyclePanel.js'), 'utf8')

    expect(lifecycleRoute).toContain('serializeProbationApproval')
    expect(lifecycleRoute).toContain('require the assigned manager approval workflow')
    expect(panel).toContain("requestProbationApproval('confirmation')")
    expect(panel).toContain('Manager remarks:')
    expect(panel).not.toContain("runAction('confirm_probation')")
  })
})
