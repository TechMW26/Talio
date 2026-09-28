jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))

import { getAuthAndModels } from '@/lib/auth'
import { POST } from '@/app/api/performance/appraisals/route'
import { POST as postAction } from '@/app/api/performance/appraisals/[id]/actions/route'

const ids = {
  requester: '76c000000000000000000001',
  requesterEmployee: '66c000000000000000000001',
  employee: '66c000000000000000000010',
  managerEmployee: '66c000000000000000000002',
  headEmployee: '66c000000000000000000003',
  department: '56c000000000000000000001',
  managerUser: '76c000000000000000000002',
  headUser: '76c000000000000000000003',
  hrUser: '76c000000000000000000004',
  adminUser: '76c000000000000000000005',
  appraisal: '86c000000000000000000001',
}

function query(result) {
  const value = {
    select: jest.fn(() => value),
    populate: jest.fn(() => value),
    lean: jest.fn().mockResolvedValue(result),
  }
  return value
}

function setup({ hrIsEarlierApprover = false, actorRole = 'team_leader', actorEmployeeId = ids.requesterEmployee } = {}) {
  const actor = { _id: ids.requester, role: actorRole, employeeId: actorEmployeeId, isActive: true }
  const target = {
    _id: ids.employee,
    firstName: 'Alex',
    lastName: 'Employee',
    employeeCode: 'E10',
    department: ids.department,
    assignedTeamLead: ids.requesterEmployee,
    assignedManager: ids.managerEmployee,
  }
  const saved = {
    _id: ids.appraisal,
    employee: ids.employee,
    reviewPeriod: 'FY 2026-27',
    proposedIncreasePercent: 8,
    reason: 'Consistent delivery and expanded ownership',
    pointers: ['Delivered release ahead of schedule'],
    requestedByUser: ids.requester,
    status: 'pending_approval',
    currentStepIndex: 0,
    approvalSteps: [],
    timeline: [],
  }
  const reviewerUsers = [
    { _id: ids.managerUser, employeeId: ids.managerEmployee, isActive: true, role: hrIsEarlierApprover ? 'hr' : 'manager' },
    { _id: ids.headUser, employeeId: ids.headEmployee, isActive: true, role: 'department_head' },
  ]
  if (hrIsEarlierApprover) reviewerUsers[1].role = 'department_head'

  const User = {
    findById: jest.fn(() => query(actor)),
    find: jest.fn((filter) => {
      if (filter.employeeId) return query(reviewerUsers)
      if (filter.role === 'hr') return query(hrIsEarlierApprover ? [] : [{ _id: ids.hrUser }])
      if (Array.isArray(filter.role?.$in)) return query([{ _id: ids.adminUser }])
      return query([])
    }),
  }
  const PerformanceAppraisal = {
    findOne: jest.fn(() => ({ select: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })) })),
    create: jest.fn(async (record) => {
      Object.assign(saved, record)
      return saved
    }),
    findById: jest.fn(() => query(saved)),
  }
  const models = {
    User,
    Employee: { findById: jest.fn(() => ({ select: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(target) })) })) },
    Department: { find: jest.fn(() => ({ select: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([{ head: ids.headEmployee, heads: [] }]) })) })) },
    Team: { find: jest.fn() },
    Notification: { create: jest.fn().mockResolvedValue({}) },
    PerformanceAppraisal,
  }
  getAuthAndModels.mockResolvedValue({ success: true, user: { _id: ids.requester }, models })
  return { models, saved }
}

beforeEach(() => jest.clearAllMocks())

test('creates a tenant appraisal request and routes manager → department head → HR', async () => {
  const { models, saved } = setup()
  const response = await POST(new Request('https://talio.test/api/performance/appraisals', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: ids.employee,
      reviewPeriod: 'FY 2026-27',
      proposedIncreasePercent: 8,
      reason: 'Consistent delivery and expanded ownership',
      pointers: ['Delivered release ahead of schedule'],
    }),
  }))

  const result = await response.json()
  expect(response.status).toBe(201)
  expect(result.data.approvalSteps.map((step) => step.role)).toEqual(['manager', 'department_head', 'hr'])
  expect(result.data.approvalSteps[2].approverUsers).toEqual([ids.hrUser])
  expect(saved.timeline).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'submitted' })]))
  expect(models.Notification.create).toHaveBeenCalledTimes(1)
})

test('does not assign the same person at hierarchy and HR stages; uses an independent admin fallback', async () => {
  const { saved } = setup({ hrIsEarlierApprover: true })
  const response = await POST(new Request('https://talio.test/api/performance/appraisals', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: ids.employee,
      reviewPeriod: 'FY 2026-27',
      proposedIncreasePercent: 8,
      reason: 'Consistent delivery and expanded ownership',
      pointers: ['Delivered release ahead of schedule'],
    }),
  }))

  expect(response.status).toBe(201)
  expect(saved.approvalSteps[0].approverUser).toBe(ids.managerUser)
  expect(saved.approvalSteps.at(-1).approverUsers).toEqual([ids.adminUser])
})

test('rejects malformed employee and appraisal IDs instead of returning server errors', async () => {
  setup()
  const createResponse = await POST(new Request('https://talio.test/api/performance/appraisals', {
    method: 'POST', body: JSON.stringify({ employeeId: 'bad', reviewPeriod: 'FY 2026', proposedIncreasePercent: 5, reason: 'Long enough reason', pointers: ['Work'] }),
  }))
  expect(createResponse.status).toBe(400)
  expect((await createResponse.json()).message).toBe('Invalid employee ID')

  const actionResponse = await postAction(new Request('https://talio.test/api/performance/appraisals/bad/actions', { method: 'POST', body: '{}' }), {
    params: Promise.resolve({ id: 'bad' }),
  })
  expect(actionResponse.status).toBe(400)
})

test('refuses a manager request outside their reporting scope', async () => {
  const { models } = setup({ actorRole: 'manager', actorEmployeeId: ids.headEmployee })
  const response = await POST(new Request('https://talio.test/api/performance/appraisals', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: ids.employee,
      reviewPeriod: 'FY 2026-27',
      proposedIncreasePercent: 8,
      reason: 'Consistent delivery and expanded ownership',
      pointers: ['Delivered release ahead of schedule'],
    }),
  }))
  expect(response.status).toBe(403)
  expect(models.PerformanceAppraisal.create).not.toHaveBeenCalled()
})

test('an assigned reviewer advances one step with optimistic concurrency and notifies the next reviewer', async () => {
  const manager = { _id: ids.managerUser, role: 'manager', isActive: true }
  const appraisal = {
    _id: ids.appraisal,
    employee: ids.employee,
    reviewPeriod: 'FY 2026-27',
    proposedIncreasePercent: 8,
    requestedByUser: ids.requester,
    currentStepIndex: 0,
    workflowVersion: 4,
    status: 'pending_approval',
    approvalSteps: [
      { role: 'manager', approverUser: ids.managerUser, status: 'pending', comment: '' },
      { role: 'department_head', approverUser: ids.headUser, status: 'pending', comment: '' },
      { role: 'hr', approverUsers: [ids.hrUser], status: 'pending', comment: '' },
    ],
    timeline: [],
  }
  const updatedRecord = { ...appraisal, currentStepIndex: 1, workflowVersion: 5, status: 'pending_approval' }
  const models = {
    User: { findById: jest.fn(() => query(manager)) },
    PerformanceAppraisal: {
      findById: jest.fn(() => query(appraisal)),
      findOneAndUpdate: jest.fn(async (filter, update) => {
        expect(filter).toMatchObject({ workflowVersion: 4, currentStepIndex: 0, status: 'pending_approval' })
        expect(update.$set.workflowVersion).toBe(5)
        updatedRecord.approvalSteps = update.$set.approvalSteps
        updatedRecord.timeline = [update.$push.timeline]
        return updatedRecord
      }),
    },
    Notification: { create: jest.fn().mockResolvedValue({}) },
  }
  getAuthAndModels.mockResolvedValue({ success: true, user: { _id: ids.managerUser }, models })
  const response = await postAction(new Request(`https://talio.test/api/performance/appraisals/${ids.appraisal}/actions`, {
    method: 'POST', body: JSON.stringify({ action: 'approve', comment: 'Reviewed against the agreed goals' }),
  }), { params: Promise.resolve({ id: ids.appraisal }) })

  expect(response.status).toBe(200)
  expect((await response.json()).data.currentStepIndex).toBe(1)
  expect(models.Notification.create).toHaveBeenCalledWith(expect.objectContaining({ user: ids.headUser }))
})

test('reports a concurrent approval conflict without notifying the next stage', async () => {
  const appraisal = {
    _id: ids.appraisal,
    employee: ids.employee,
    reviewPeriod: 'FY 2026-27',
    proposedIncreasePercent: 8,
    currentStepIndex: 0,
    workflowVersion: 4,
    status: 'pending_approval',
    approvalSteps: [{ role: 'manager', approverUser: ids.managerUser, status: 'pending' }],
  }
  const models = {
    User: { findById: jest.fn(() => query({ _id: ids.managerUser, role: 'manager', isActive: true })) },
    PerformanceAppraisal: {
      findById: jest.fn(() => query(appraisal)),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
    },
    Notification: { create: jest.fn() },
  }
  getAuthAndModels.mockResolvedValue({ success: true, user: { _id: ids.managerUser }, models })
  const response = await postAction(new Request(`https://talio.test/api/performance/appraisals/${ids.appraisal}/actions`, {
    method: 'POST', body: JSON.stringify({ action: 'approve' }),
  }), { params: Promise.resolve({ id: ids.appraisal }) })

  expect(response.status).toBe(409)
  expect(models.Notification.create).not.toHaveBeenCalled()
})

test('HR must record discussion notes and an explicit decision before finalizing', async () => {
  const appraisal = {
    _id: ids.appraisal,
    employee: ids.employee,
    reviewPeriod: 'FY 2026-27',
    proposedIncreasePercent: 8,
    requestedByUser: ids.requester,
    currentStepIndex: 2,
    workflowVersion: 7,
    status: 'hr_discussion',
    approvalSteps: [
      { role: 'manager', approverUser: ids.managerUser, status: 'approved' },
      { role: 'department_head', approverUser: ids.headUser, status: 'approved' },
      { role: 'hr', approverUsers: [ids.hrUser], status: 'pending' },
    ],
  }
  const updatedRecord = { ...appraisal, status: 'approved', workflowVersion: 8 }
  const models = {
    User: { findById: jest.fn(() => query({ _id: ids.hrUser, role: 'hr', isActive: true })) },
    PerformanceAppraisal: {
      findById: jest.fn(() => query(appraisal)),
      findOneAndUpdate: jest.fn(async (_filter, update) => {
        updatedRecord.hrDiscussion = update.$set.hrDiscussion
        updatedRecord.approvalSteps = update.$set.approvalSteps
        updatedRecord.timeline = [update.$push.timeline]
        return updatedRecord
      }),
    },
    Notification: { create: jest.fn().mockResolvedValue({}) },
  }
  getAuthAndModels.mockResolvedValue({ success: true, user: { _id: ids.hrUser }, models })

  const response = await postAction(new Request(`https://talio.test/api/performance/appraisals/${ids.appraisal}/actions`, {
    method: 'POST',
    body: JSON.stringify({
      action: 'complete_discussion',
      outcome: 'approved',
      comment: 'Discussed the recommendation with HR and documented the rationale.',
    }),
  }), { params: Promise.resolve({ id: ids.appraisal }) })
  const result = await response.json()

  expect(response.status).toBe(200)
  expect(result.data.status).toBe('approved')
  expect(result.data.hrDiscussion).toMatchObject({ outcome: 'approved', completedBy: ids.hrUser })
  expect(models.Notification.create).toHaveBeenCalledWith(expect.objectContaining({ user: ids.requester }))
})
