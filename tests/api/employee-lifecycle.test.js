import {
  addMonthsClamped,
  applyLifecycleAction,
  buildEmployeeLifecycle,
  getLifecycleProgress,
  hydrateEmployeeLifecycle,
  reconcileOnboardingChecklist,
  toIstDateKey,
} from '@/lib/hrms/employeeLifecycle.server'
import { getOnboardingCompletionSignals } from '@/lib/hrms/onboardingProgress.server'
import fs from 'node:fs'
import path from 'node:path'

describe('employee lifecycle', () => {
  test('clamps probation dates at month end without timezone drift', () => {
    expect(addMonthsClamped('2026-01-31', 1).toISOString().slice(0, 10)).toBe('2026-02-28')
    expect(addMonthsClamped('2028-01-31', 1).toISOString().slice(0, 10)).toBe('2028-02-29')
  })

  test('normalizes persisted UTC instants to the IST business date', () => {
    expect(toIstDateKey(new Date('2026-08-30T18:30:00.000Z'))).toBe('2026-08-31')
  })

  test('builds pre-boarding, checklist and probation from employee creation choices', () => {
    const lifecycle = buildEmployeeLifecycle({
      dateOfJoining: '2026-10-01',
      employmentType: 'full-time',
      probationApplicable: true,
      probationDurationMonths: 6,
      noticePeriodDays: 60,
      backgroundVerificationRequired: true,
      assetProvisioningRequired: true,
    }, new Date('2026-08-31T12:00:00.000Z'))
    expect(lifecycle.stage).toBe('preboarding')
    expect(lifecycle.probation.endDate.toISOString().slice(0, 10)).toBe('2027-04-01')
    expect(lifecycle.onboarding.checklist.map((item) => item.key)).toEqual(expect.arrayContaining(['background_verification', 'assets', 'payroll']))
    expect(lifecycle.noticePeriodDays).toBe(60)
  })

  test('waives probation for contractors and omits optional onboarding work', () => {
    const lifecycle = buildEmployeeLifecycle({
      dateOfJoining: '2026-08-01', employmentType: 'contract',
      backgroundVerificationRequired: false, assetProvisioningRequired: false,
    }, new Date('2026-08-31T12:00:00.000Z'))
    expect(lifecycle.probation).toMatchObject({ applicable: false, status: 'waived' })
    expect(lifecycle.onboarding.checklist.map((item) => item.key)).not.toEqual(expect.arrayContaining(['background_verification', 'assets']))
    expect(lifecycle.offboarding.assetsReturned).toBe(true)
  })

  test('hydrates legacy employees with the default lifecycle checklist', () => {
    const lifecycle = hydrateEmployeeLifecycle({ dateOfJoining: '2026-08-01', employmentType: 'full-time', lifecycle: { stage: 'onboarding' } })
    expect(lifecycle.onboarding.checklist.length).toBeGreaterThan(4)
  })

  test('completes onboarding and advances to probation only after all required items', () => {
    let lifecycle = buildEmployeeLifecycle({ dateOfJoining: '2026-08-01', probationApplicable: true, backgroundVerificationRequired: false, assetProvisioningRequired: false })
    for (const item of lifecycle.onboarding.checklist) {
      lifecycle = applyLifecycleAction(lifecycle, 'complete_onboarding_item', { itemKey: item.key }, { actorId: 'u1' }).lifecycle
    }
    expect(getLifecycleProgress(lifecycle).percentage).toBe(100)
    expect(lifecycle.onboarding.status).toBe('completed')
    expect(lifecycle.stage).toBe('probation')
    expect(lifecycle.onboarding.checklist.every((item) => item.completionSource === 'manual')).toBe(true)
  })

  test('automatically reconciles completed onboarding work from linked HRMS records', () => {
    const lifecycle = buildEmployeeLifecycle({ dateOfJoining: '2026-08-01' })
    const signals = Object.fromEntries(lifecycle.onboarding.checklist.map((item) => [item.key, true]))
    const result = reconcileOnboardingChecklist(lifecycle, signals, { now: '2026-08-31' })

    expect(result.changed).toBe(true)
    expect(result.completedKeys).toHaveLength(lifecycle.onboarding.checklist.length)
    expect(result.lifecycle.onboarding.checklist.every((item) => item.completed && item.completionSource === 'system')).toBe(true)
    expect(result.lifecycle.onboarding.status).toBe('completed')
    expect(result.lifecycle.stage).toBe('probation')
  })

  test('does not undo previously verified work when a linked record is later unavailable', () => {
    const lifecycle = buildEmployeeLifecycle({ dateOfJoining: '2026-08-01' })
    const completed = reconcileOnboardingChecklist(lifecycle, { profile: true }, { now: '2026-08-31' }).lifecycle
    const result = reconcileOnboardingChecklist(completed, { profile: false }, { now: '2026-09-01' })

    expect(result.changed).toBe(false)
    expect(result.lifecycle.onboarding.checklist.find((item) => item.key === 'profile')).toMatchObject({
      completed: true,
      completionSource: 'system',
    })
  })

  test('derives automatic signals from employee records and linked module completion', async () => {
    const employeeId = '6a74712f87b6bf60ff871f97'
    const query = (value) => ({
      select() { return this },
      lean() { return Promise.resolve(value) },
    })
    const models = {
      Document: { exists: jest.fn() },
      Asset: { exists: jest.fn(() => Promise.resolve({ _id: 'asset-1' })) },
      Payroll: { exists: jest.fn(() => Promise.resolve({ _id: 'payroll-1' })) },
      HrmsWorkflow: { find: jest.fn(() => query([{ module: 'backgroundVerification' }, { module: 'departmentInduction' }])) },
      Policy: { find: jest.fn(() => query([{ acknowledgments: [{ employee: employeeId }] }])) },
    }
    const signals = await getOnboardingCompletionSignals({
      models,
      employee: {
        _id: employeeId,
        firstName: 'Muskan', lastName: 'Adwani', email: 'muskan@example.com', phone: '7000000000',
        dateOfJoining: new Date('2026-08-01'), emergencyContact: { name: 'Contact', phone: '7000000001' },
        documents: [{ url: '/document.pdf' }],
        bankDetails: { bankName: 'Bank', accountNumber: '123', ifscCode: 'BANK0001' },
        salary: { basic: 10000 },
      },
    })

    expect(signals).toEqual({
      profile: true,
      documents: true,
      background_verification: true,
      payroll: true,
      policies: true,
      induction: true,
      assets: true,
    })
    expect(models.Document.exists).not.toHaveBeenCalled()
  })

  test('requires a reason to extend probation and updates the review date', () => {
    const lifecycle = buildEmployeeLifecycle({ dateOfJoining: '2026-08-01', probationDurationMonths: 3 })
    expect(() => applyLifecycleAction(lifecycle, 'extend_probation', { months: 1 })).toThrow('reason')
    const result = applyLifecycleAction(lifecycle, 'extend_probation', { months: 2, reason: 'Needs another review cycle' })
    expect(result.lifecycle.probation.status).toBe('extended')
    expect(result.lifecycle.probation.reviewDate.toISOString().slice(0, 10)).toBe('2027-01-01')
    expect(result.employeeUpdates.status).toBe('probation')
  })

  test('validates offboarding chronology and blocks premature completion', () => {
    const lifecycle = buildEmployeeLifecycle({ dateOfJoining: '2026-01-01' })
    expect(() => applyLifecycleAction(lifecycle, 'start_offboarding', {
      resignationDate: '2026-09-01', lastWorkingDate: '2026-08-31',
    })).toThrow('cannot be before')

    const started = applyLifecycleAction(lifecycle, 'start_offboarding', {
      resignationDate: '2026-08-31', lastWorkingDate: '2026-09-30', separationType: 'resignation',
    }, { now: '2026-08-31' })
    expect(started.lifecycle.stage).toBe('notice_period')
    expect(() => applyLifecycleAction(started.lifecycle, 'complete_offboarding')).toThrow('must be cleared')
  })

  test('moves a cleared employee to alumni and updates employment status', () => {
    let lifecycle = buildEmployeeLifecycle({ dateOfJoining: '2026-01-01', assetProvisioningRequired: false })
    lifecycle = applyLifecycleAction(lifecycle, 'start_offboarding', {
      resignationDate: '2026-08-01', lastWorkingDate: '2026-08-31', separationType: 'resignation',
    }, { now: '2026-08-01' }).lifecycle
    lifecycle = applyLifecycleAction(lifecycle, 'update_offboarding', { field: 'accessRevoked', value: true }).lifecycle
    lifecycle = applyLifecycleAction(lifecycle, 'update_offboarding', { field: 'fullAndFinalStatus', value: 'completed' }).lifecycle
    const result = applyLifecycleAction(lifecycle, 'complete_offboarding', {}, { now: '2026-08-31' })
    expect(result.lifecycle.stage).toBe('alumni')
    expect(result.employeeUpdates.status).toBe('resigned')
  })

  test('candidate conversion uses the canonical employee lifecycle path', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/api/recruitment/candidates/convert/route.js'), 'utf8')
    expect(source).toContain('dateOfJoining:')
    expect(source).toContain('buildEmployeeLifecycle')
    expect(source).toContain('createInitialLifecycleWorkflows')
    expect(source).not.toMatch(/\n\s+joiningDate:\s+joiningDate/)
  })

  test('lifecycle API and UI keep non-JSON failures user-safe', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'app/api/employees/[id]/lifecycle/route.js'), 'utf8')
    const panel = fs.readFileSync(path.join(process.cwd(), 'components/employees/EmployeeLifecyclePanel.js'), 'utf8')
    expect(route).toContain("code: 'LIFECYCLE_ERROR'")
    expect(route).toContain("message: 'Invalid JSON request body'")
    expect(panel).toContain('const responseText = await response.text()')
    expect(panel).toContain('The lifecycle service returned an invalid response')
  })
})
