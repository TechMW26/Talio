import { buildHrmsFeatureMigration, changedFeatureFlags } from '@/lib/hrms/migration'

describe('HRMS workflow migration', () => {
  test('preserves unrelated flags and fills every canonical module deterministically', () => {
    const migrated = buildHrmsFeatureMigration({ meetings: true, payroll: false })
    expect(migrated.meetings).toBe(true)
    expect(migrated.payroll).toBe(false)
    expect(migrated.manpowerPlanning).toBe(false)
    expect(migrated.alumni).toBe(false)
  })

  test('repairs enabled dependency chains without disabling explicit modules', () => {
    const migrated = buildHrmsFeatureMigration({ interviews: true })
    expect(migrated.interviews).toBe(true)
    expect(migrated.recruitment).toBe(true)
    expect(migrated.mrfWorkflow).toBe(true)
    expect(migrated.manpowerPlanning).toBe(true)
  })

  test('reports only canonical flags whose values changed', () => {
    expect(changedFeatureFlags({ payroll: false }, { payroll: false, alumni: false })).toEqual(['alumni'])
  })
})
