import { validateSettlement } from '@/lib/hrms/settlement'
import { applyLifecycleAction } from '@/lib/hrms/employeeLifecycle.server'

const settlement = { date: '2026-09-25', items: [{ label: 'Salary', type: 'earning', amount: 100.10 }, { label: 'Recovery', type: 'deduction', amount: 20.05 }] }
test('calculates settlement using minor currency units', () => {
  expect(validateSettlement(settlement).netAmount).toBe(80.05)
})
test.each(['2026-02-30', 'invalid', ''])('rejects invalid date %s', date => {
  expect(() => validateSettlement({ ...settlement, date })).toThrow('date')
})
test('rejects invalid amounts and empty components', () => {
  expect(() => validateSettlement({ ...settlement, items: [] })).toThrow('components')
  expect(() => validateSettlement({ ...settlement, items: [{ label: 'Bad', type: 'earning', amount: -1 }] })).toThrow('amount')
})
test('saves settlement without recording a payment', () => {
  const result = applyLifecycleAction({ offboarding: { status: 'in_progress' } }, 'save_settlement', { settlement })
  expect(result.lifecycle.offboarding.fullAndFinalStatus).toBe('pending')
  expect(result.lifecycle.offboarding.settlement.netAmount).toBe(80.05)
})

test('persists editable letter drafts without changing employee status', () => {
  const result = applyLifecycleAction({}, 'save_onboarding_letter', { kind: 'appointment', content: 'Approved draft' })
  expect(result.lifecycle.letterDraft.content).toBe('Approved draft')
  expect(result.employeeUpdates).toEqual({})
  expect(() => applyLifecycleAction({}, 'save_onboarding_letter', { kind: 'invalid', content: 'text' })).toThrow('letter')
})
