import {
  buildWorkflowVisibilityFilter,
  canCreateWorkflow,
  sanitizeWorkflowData,
  transitionWorkflow,
  validateWorkflowPayload,
} from '@/lib/hrms/workflowService.server'

describe('HRMS workflow service', () => {
  test('validates module-specific required data', () => {
    expect(validateWorkflowPayload({ module: 'mrfWorkflow', title: 'New engineer', data: {} }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'data.department' }),
        expect.objectContaining({ field: 'data.roleTitle' }),
        expect.objectContaining({ field: 'data.headcount' }),
        expect.objectContaining({ field: 'data.justification' }),
      ]))
    expect(validateWorkflowPayload({
      module: 'mrfWorkflow',
      title: 'New engineer',
      data: { department: 'Engineering', roleTitle: 'Engineer', headcount: 2, justification: 'Growth' },
    })).toEqual([])
  })

  test('rejects unknown modules and overlong titles', () => {
    const errors = validateWorkflowPayload({ module: 'unknown', title: 'x'.repeat(201), data: {} })
    expect(errors.map((error) => error.field)).toEqual(expect.arrayContaining(['module', 'title']))
  })

  test('sanitizes prototype-pollution keys while preserving normal nested input', () => {
    const input = JSON.parse('{"safe":{"value":1},"__proto__":{"polluted":true},"constructor":"bad"}')
    expect(sanitizeWorkflowData(input)).toEqual({ safe: { value: 1 } })
    expect({}.polluted).toBeUndefined()
  })

  test('limits self-service modules but allows HR lifecycle management', () => {
    expect(canCreateWorkflow('employee', 'helpdesk')).toBe(true)
    expect(canCreateWorkflow('employee', 'payroll')).toBe(false)
    expect(canCreateWorkflow('hr', 'payroll')).toBe(true)
  })

  test('keeps confidential manager access scoped to assigned or owned cases', () => {
    expect(buildWorkflowVisibilityFilter({ role: 'manager', id: 'u1', employeeId: 'e1' }))
      .toEqual({ $or: [
        { confidential: { $ne: true } },
        { owner: 'u1' },
        { createdBy: 'u1' },
        { assignees: 'u1' },
        { subjectEmployee: 'e1' },
      ] })
  })

  test('rejects invalid transitions without writing', async () => {
    const Workflow = { findOneAndUpdate: jest.fn() }
    const Event = { create: jest.fn() }
    const result = await transitionWorkflow({
      Workflow, Event,
      workflow: { _id: 'case1', version: 1, status: 'draft', module: 'mrfWorkflow' },
      actor: { id: 'u1', role: 'hr' },
      action: 'approve',
    })
    expect(result).toMatchObject({ success: false, status: 409, code: 'INVALID_TRANSITION' })
    expect(Workflow.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('uses optimistic concurrency and writes an immutable audit event', async () => {
    const updated = { _id: 'case1', version: 2, status: 'submitted', module: 'mrfWorkflow' }
    const Workflow = { findOneAndUpdate: jest.fn().mockResolvedValue(updated) }
    const Event = { create: jest.fn().mockResolvedValue({}) }
    const result = await transitionWorkflow({
      Workflow, Event,
      workflow: { _id: 'case1', version: 1, status: 'draft', module: 'mrfWorkflow' },
      actor: { id: 'u1', role: 'employee' },
      action: 'submit',
    })
    expect(result).toMatchObject({ success: true, workflow: updated })
    expect(Workflow.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'case1', version: 1 },
      expect.objectContaining({ $inc: { version: 1 } }),
      { new: true },
    )
    expect(Event.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'submit', fromStatus: 'draft', toStatus: 'submitted' }))
  })

  test('returns a version conflict if another actor won the race', async () => {
    const result = await transitionWorkflow({
      Workflow: { findOneAndUpdate: jest.fn().mockResolvedValue(null) },
      Event: { create: jest.fn() },
      workflow: { _id: 'case1', version: 3, status: 'submitted', module: 'mrfWorkflow' },
      actor: { id: 'u2', role: 'hr' },
      action: 'approve',
    })
    expect(result).toMatchObject({ success: false, status: 409, code: 'VERSION_CONFLICT' })
  })
})
