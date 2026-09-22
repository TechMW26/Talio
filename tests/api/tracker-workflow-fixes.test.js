import { prorateAnnualLeave } from '@/lib/leaveData'
import { ensureEmployeeLeaveBalances } from '@/lib/leaveAllocation.server'
import { sanitizeTicketUpdate } from '@/lib/helpdeskInput'

describe('calendar-day leave allocation', () => {
  test.each([
    ['2025-06-01', 2026, 12], ['2026-01-01', 2026, 12],
    ['2026-07-01', 2026, 6.05], ['2026-12-31', 2026, 0.03],
    ['2027-01-01', 2026, 0], ['2024-07-01', 2024, 6.03],
  ])('prorates joining %s for %s', (joined, year, expected) => {
    expect(prorateAnnualLeave(12, joined, year)).toBe(expected)
  })
  test('handles legacy missing dates and invalid entitlement safely', () => {
    expect(prorateAnnualLeave(12, null, 2026)).toBe(12)
    expect(prorateAnnualLeave(-5, '2026-01-01', 2026)).toBe(0)
    expect(prorateAnnualLeave(Infinity, null, 2026)).toBe(0)
    expect(() => prorateAnnualLeave(12, null, 'bad')).toThrow('Invalid leave year')
  })
  test('uses insert-only updates to preserve adjustments, pending requests and usage', async () => {
    const query = value => ({ select: () => ({ lean: async () => value }) })
    const bulkWrite = jest.fn().mockResolvedValue({ upsertedCount: 1 })
    const models = {
      Employee: { findById: () => query({ _id: 'employee', status: 'probation', dateOfJoining: '2026-07-01' }) },
      LeaveType: { find: () => query([{ _id: 'annual', maxDaysPerYear: 12 }]) },
      LeaveBalance: { bulkWrite },
    }
    await ensureEmployeeLeaveBalances({ models, employeeId: 'employee', year: 2026 })
    const operation = bulkWrite.mock.calls[0][0][0].updateOne
    expect(operation.update.$setOnInsert.totalDays).toBe(6.05)
    expect(Object.keys(operation.update)).toEqual(['$setOnInsert'])
    expect(operation.filter).toEqual({ employee: 'employee', leaveType: 'annual', year: 2026 })
  })
})

describe('helpdesk update validation', () => {
  test('status-only updates do not reference undefined attachment variables', () => {
    expect(sanitizeTicketUpdate({ status: 'in-progress' })).toEqual({ status: 'in-progress', resolvedAt: null, closedAt: null })
  })
  test('closing preserves the resolution timestamp', () => {
    expect(sanitizeTicketUpdate({ status: 'closed' })).not.toHaveProperty('resolvedAt')
  })
  test('ignores protected fields and rejects invalid values', () => {
    expect(sanitizeTicketUpdate({ status: 'resolved', createdBy: 'someone', ticketNumber: 'tampered' })).not.toHaveProperty('createdBy')
    for (const value of [{ status: 'wrong' }, { assignedTo: 'wrong' }, { attachments: ['file'] }, { $set: { status: 'resolved' } }]) {
      expect(() => sanitizeTicketUpdate(value)).toThrow()
    }
  })
  test('accepts valid attachments but blocks script/protocol-relative URLs', () => {
    expect(sanitizeTicketUpdate({ attachments: [{ url: '/api/files/doc', fileName: 'proof.pdf' }] }).attachments).toHaveLength(1)
    for (const url of ['javascript:alert(1)', '//attacker.test/file']) {
      expect(() => sanitizeTicketUpdate({ attachments: [{ url }] })).toThrow()
    }
  })
})
