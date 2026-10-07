import {
  canCreateWorkflow,
  createWorkflow,
  sanitizeWorkflowData,
  transitionWorkflow,
  validateWorkflowPayload,
} from '@/lib/hrms/workflowService.server'

import { canReadWorkflow } from '@/lib/hrms/workflowStore.server'
import { workflowStore } from '../helpers/firestoreWorkflowStore'

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

  test('rejects the retired LMS module', () => {
    expect(validateWorkflowPayload({ module: 'learning', title: 'Old course', data: {} }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ field: 'module', message: 'Unknown HRMS module' })]))
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
    const user = { role: 'manager', id: 'u1', employeeId: 'e1' }
    expect(canReadWorkflow(user, { confidential: true, owner: 'other' })).toBe(false)
    expect(canReadWorkflow(user, { confidential: true, owner: 'u1' })).toBe(true)
    expect(canReadWorkflow(user, { confidential: false })).toBe(true)
  })
  test('rejects invalid transitions without writing', async () => {
    const database = workflowStore()
    const result = await transitionWorkflow({ database, workflow: { _id: 'case1', version: 1, status: 'draft', module: 'mrfWorkflow' }, actor: { id: 'u1', role: 'hr' }, action: 'approve' })
    expect(result).toMatchObject({ success: false, status: 409, code: 'INVALID_TRANSITION' })
    expect(database.transaction).not.toHaveBeenCalled()
  })
  test('uses optimistic concurrency and atomically writes an immutable audit event', async () => {
    const workflow = { _id: 'case1', version: 1, status: 'draft', module: 'mrfWorkflow' }
    const database = workflowStore({ hrmsworkflows: [workflow] })
    const result = await transitionWorkflow({ database, workflow, actor: { id: 'u1', role: 'employee' }, action: 'submit' })
    expect(result).toMatchObject({ success: true, workflow: { _id: 'case1', version: 2, status: 'submitted' } })
    expect((await database.list('hrmsworkflowevents')).records[0]).toMatchObject({ type: 'submit', fromStatus: 'draft', toStatus: 'submitted' })
  })
  test('returns version conflict if another actor won the race', async () => {
    const database = workflowStore()
    const result = await transitionWorkflow({ database, workflow: { _id: 'case1', version: 3, status: 'submitted', module: 'mrfWorkflow' }, actor: { id: 'u2', role: 'hr' }, action: 'approve' })
    expect(result).toMatchObject({ success: false, status: 409, code: 'VERSION_CONFLICT' })
  })
  test('create retries reuse deterministic ID and event; event failure rolls back workflow', async () => {
    const database = workflowStore(), args = { database, actor: { id: 'u1', role: 'hr' }, payload: { module: 'helpdesk', title: 'Printer repair', data: {}, idempotencyKey: 'stable' }, allowIncompleteData: true }
    const first = await createWorkflow(args)
    const second = await createWorkflow(args)
    expect(first.success).toBe(true); expect(second.deduplicated).toBe(true)
    expect(first.workflow._id).toBe(second.workflow._id)
    expect(await database.count('hrmsworkflowevents')).toBe(1)
    database.failCreate = 'hrmsworkflowevents'
    await expect(createWorkflow({ ...args, payload: { ...args.payload, idempotencyKey: 'other' } })).rejects.toThrow('Simulated write failure')
    expect(await database.count('hrmsworkflows')).toBe(1)
  })
})
