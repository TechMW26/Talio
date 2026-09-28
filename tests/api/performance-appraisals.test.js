import fs from 'node:fs'
import path from 'node:path'
import {
  appendHrReviewStep,
  buildAppraisalApprovalChain,
  canActOnAppraisal,
  getRequesterTier,
  isValidAppraisalObjectId,
  transitionAppraisal,
  validateAppraisalRequest,
} from '@/lib/hrms/performanceAppraisal.server'

const ids = {
  employee: '66c000000000000000000001',
  teamLead: '66c000000000000000000002',
  manager: '66c000000000000000000003',
  departmentHead: '66c000000000000000000004',
  teamLeadUser: '76c000000000000000000002',
  managerUser: '76c000000000000000000003',
  headUser: '76c000000000000000000004',
  hrUser: '76c000000000000000000005',
}

const users = [
  { _id: ids.teamLeadUser, employeeId: ids.teamLead, isActive: true },
  { _id: ids.managerUser, employeeId: ids.manager, isActive: true },
  { _id: ids.headUser, employeeId: ids.departmentHead, isActive: true },
]

describe('performance appraisal workflow', () => {
  test('validates percentage, reason, review period, and supporting pointers', () => {
    expect(validateAppraisalRequest({
      reviewPeriod: 'FY 2026-27', proposedIncreasePercent: '7.5',
      reason: 'Consistently exceeded goals', pointers: ['Delivered project early'],
    })).toEqual({
      reviewPeriod: 'FY 2026-27', proposedIncreasePercent: 7.5,
      reason: 'Consistently exceeded goals', pointers: ['Delivered project early'],
    })
    expect(() => validateAppraisalRequest({ reviewPeriod: 'FY 2026', proposedIncreasePercent: '', reason: 'reason long enough', pointers: ['x'] })).toThrow('percentage is required')
    expect(() => validateAppraisalRequest({ reviewPeriod: 'FY 2026', proposedIncreasePercent: 101, reason: 'reason long enough', pointers: ['x'] })).toThrow('between 0 and 100')
    expect(() => validateAppraisalRequest({ reviewPeriod: 'FY 2026', proposedIncreasePercent: 5, reason: 'short', pointers: [] })).toThrow('clear reason')
    expect(() => validateAppraisalRequest({ reviewPeriod: 'FY 2026', proposedIncreasePercent: 5, reason: 'long enough reason', pointers: [] })).toThrow('at least one')
    expect(() => validateAppraisalRequest({ reviewPeriod: 'x'.repeat(81), proposedIncreasePercent: 5, reason: 'long enough reason', pointers: ['x'] })).toThrow('80 characters')
    expect(() => validateAppraisalRequest({ reviewPeriod: 'FY 2026', proposedIncreasePercent: 5, reason: 'long enough reason', pointers: ['x'.repeat(501)] })).toThrow('500 characters')
    expect(() => validateAppraisalRequest({ reviewPeriod: 'FY 2026', proposedIncreasePercent: 5, reason: 'long enough reason', pointers: Array(13).fill('x') })).toThrow('no more than 12')
  })

  test('routes a team-lead request through manager, department head, and an independent HR discussion', () => {
    const chain = buildAppraisalApprovalChain({
      employee: { _id: ids.employee, assignedTeamLead: ids.teamLead, assignedManager: ids.manager },
      departmentHeadEmployeeIds: [ids.departmentHead], users, requesterTier: getRequesterTier({ role: 'team_leader' }),
      requesterEmployeeId: ids.teamLead,
    })
    expect(chain.map((step) => [step.role, step.approverEmployee])).toEqual([
      ['manager', ids.manager], ['department_head', ids.departmentHead],
    ])
    const fullChain = appendHrReviewStep(chain, [ids.hrUser, ids.managerUser])
    expect(fullChain.map((step) => step.role)).toEqual(['manager', 'department_head', 'hr'])
    expect(fullChain[2].approverUsers).toEqual([ids.hrUser])
    expect(() => appendHrReviewStep(chain, [ids.managerUser, ids.headUser])).toThrow('No independent HR reviewer')
  })

  test('manager request omits lower team-lead approval; duplicates are routed once at the highest tier', () => {
    const managerChain = buildAppraisalApprovalChain({
      employee: { _id: ids.employee, assignedTeamLead: ids.teamLead, assignedManager: ids.manager },
      departmentHeadEmployeeIds: [ids.departmentHead], users, requesterTier: getRequesterTier({ role: 'manager' }),
      requesterEmployeeId: ids.manager,
    })
    expect(managerChain.map((step) => step.role)).toEqual(['department_head'])

    const duplicateChain = buildAppraisalApprovalChain({
      employee: { _id: ids.employee, assignedTeamLead: ids.teamLead, assignedManager: ids.manager },
      departmentHeadEmployeeIds: [ids.manager], users, requesterTier: getRequesterTier({ role: 'team_leader' }),
    })
    expect(duplicateChain).toHaveLength(1)
    expect(duplicateChain[0]).toMatchObject({ role: 'department_head', coveredRoles: ['manager', 'department_head'] })
  })

  test('fails closed when an active approver or required tier is missing', () => {
    expect(() => buildAppraisalApprovalChain({
      employee: { _id: ids.employee, assignedTeamLead: ids.teamLead, assignedManager: ids.manager },
      departmentHeadEmployeeIds: [ids.departmentHead], users: users.filter((user) => user.employeeId !== ids.manager),
      requesterTier: 0,
    })).toThrow('active manager account')
    expect(() => buildAppraisalApprovalChain({
      employee: { _id: ids.employee, assignedManager: ids.manager }, departmentHeadEmployeeIds: [], users,
      requesterTier: 1,
    })).toThrow('active department head')
  })

  test('enforces assigned approver and moves forward one stage at a time', () => {
    const appraisal = {
      currentStepIndex: 0,
      approvalSteps: [
        { role: 'manager', approverUser: ids.managerUser, status: 'pending' },
        { role: 'department_head', approverUser: ids.headUser, status: 'pending' },
        { role: 'hr', approverUsers: [ids.hrUser], status: 'pending' },
      ],
    }
    expect(canActOnAppraisal(appraisal, { _id: ids.teamLeadUser, role: 'team_leader' })).toBe(false)
    expect(canActOnAppraisal(appraisal, { _id: ids.managerUser, role: 'manager' })).toBe(true)
    const first = transitionAppraisal({ appraisal, action: 'approve', actorId: ids.managerUser, actorRole: 'manager', comment: 'Reviewed' })
    expect(first).toMatchObject({ status: 'pending_approval', currentStepIndex: 1 })
    const second = transitionAppraisal({ appraisal: { ...appraisal, ...first }, action: 'approve', actorId: ids.headUser, actorRole: 'department_head' })
    expect(second).toMatchObject({ status: 'hr_discussion', currentStepIndex: 2 })
    expect(() => transitionAppraisal({ appraisal, action: 'reject', actorId: ids.managerUser, actorRole: 'manager' })).toThrow('reason is required')
  })

  test('requires documented HR outcome and records the final discussion', () => {
    const appraisal = { currentStepIndex: 0, approvalSteps: [{ role: 'hr', approverUsers: [ids.hrUser], status: 'pending' }] }
    expect(canActOnAppraisal(appraisal, { _id: ids.hrUser, role: 'hr' })).toBe(true)
    expect(canActOnAppraisal(appraisal, { _id: ids.managerUser, role: 'hr' })).toBe(false)
    expect(canActOnAppraisal(appraisal, { _id: ids.managerUser, role: 'admin' })).toBe(false)
    expect(() => transitionAppraisal({ appraisal, action: 'complete_discussion', outcome: 'approved', comment: 'ok', actorId: ids.hrUser, actorRole: 'hr' })).toThrow('HR discussion notes')
    expect(transitionAppraisal({ appraisal, action: 'complete_discussion', outcome: 'approved', comment: 'Reviewed with HR; approved', actorId: ids.hrUser, actorRole: 'hr' })).toMatchObject({
      status: 'approved', hrDiscussion: { outcome: 'approved', notes: 'Reviewed with HR; approved' },
    })
    expect(() => transitionAppraisal({ appraisal, action: 'complete_discussion', outcome: 'pending', comment: 'Reviewed with HR', actorId: ids.hrUser, actorRole: 'hr' })).toThrow('Choose an HR discussion outcome')
  })

  test('validates strict IDs and treats department managers as the manager tier', () => {
    expect(isValidAppraisalObjectId(ids.employee)).toBe(true)
    expect(isValidAppraisalObjectId('not-an-id')).toBe(false)
    expect(isValidAppraisalObjectId('66c00000000000000000000z')).toBe(false)
    expect(getRequesterTier({ role: 'employee', isDepartmentManager: true })).toBe(1)
    expect(getRequesterTier({ role: 'employee', isDepartmentHead: true })).toBe(2)
  })

  test('is registered as a tenant model and uses scoped, version-checked API writes', () => {
    const root = process.cwd()
    const tenantModels = fs.readFileSync(path.join(root, 'lib/tenantModels.js'), 'utf8')
    const route = fs.readFileSync(path.join(root, 'app/api/performance/appraisals/route.js'), 'utf8')
    const actionRoute = fs.readFileSync(path.join(root, 'app/api/performance/appraisals/[id]/actions/route.js'), 'utf8')
    expect(tenantModels).toContain('PerformanceAppraisal: PerformanceAppraisalSchema')
    expect(route).toContain('getAuthAndModels(request')
    expect(route).toContain('PerformanceAppraisal')
    expect(route).toContain('canRaiseForTarget')
    expect(actionRoute).toContain('workflowVersion: expectedVersion')
    expect(actionRoute.includes('.salary =')).toBe(false)
    expect(actionRoute.includes('Payroll.update')).toBe(false)
  })
})
