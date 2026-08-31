import {
  HRMS_MODULE_KEYS,
  getHrmsFeatureConflicts,
  normalizeHrmsFeatures,
  toggleHrmsModule,
} from '@/lib/hrms/moduleRegistry'
import { ALL_FEATURE_KEYS, getApiFeatureRule, getFeaturesForPlan, mergeCompanyFeatures } from '@/lib/planFeatures'

describe('HRMS module registry', () => {
  test('defines every gap-analysis workflow stage exactly once', () => {
    expect(HRMS_MODULE_KEYS).toHaveLength(31)
    expect(new Set(HRMS_MODULE_KEYS).size).toBe(HRMS_MODULE_KEYS.length)
    expect(HRMS_MODULE_KEYS).toEqual(expect.arrayContaining([
      'manpowerPlanning', 'mrfWorkflow', 'recruitment', 'onboarding', 'attendanceMachines',
      'gpsAttendance', 'payroll', 'performance', 'exitManagement',
      'fullAndFinal', 'experienceLetters', 'alumni',
    ]))
    expect(ALL_FEATURE_KEYS).toEqual(expect.arrayContaining(HRMS_MODULE_KEYS))
  })

  test('enabling a downstream stage recursively enables prerequisites', () => {
    const enabled = toggleHrmsModule({}, 'preJoining', true)
    expect(enabled).toMatchObject({
      manpowerPlanning: true,
      mrfWorkflow: true,
      recruitment: true,
      interviews: true,
      offers: true,
      preJoining: true,
    })
    expect(getHrmsFeatureConflicts(enabled)).toEqual([])
  })

  test('disabling a prerequisite recursively disables dependants', () => {
    const allEnabled = Object.fromEntries(HRMS_MODULE_KEYS.map((key) => [key, true]))
    const disabled = toggleHrmsModule(allEnabled, 'exitManagement', false)
    expect(disabled.exitManagement).toBe(false)
    expect(disabled.fullAndFinal).toBe(false)
    expect(disabled.experienceLetters).toBe(false)
    expect(disabled.alumni).toBe(false)
    expect(disabled.payroll).toBe(true)
  })

  test('normalizes persisted invalid combinations without discarding unknown flags', () => {
    const normalized = normalizeHrmsFeatures({ fullAndFinal: true, futureFeature: true })
    expect(normalized.exitManagement).toBe(true)
    expect(normalized.payroll).toBe(true)
    expect(normalized.gpsAttendance).toBe(true)
    expect(normalized.futureFeature).toBe(true)
    expect(getHrmsFeatureConflicts(normalized)).toEqual([])
  })

  test('plan and tenant merges always return a valid dependency graph', () => {
    for (const plan of ['budget', 'starter', 'professional', 'enterprise', 'trial', 'custom']) {
      expect(getHrmsFeatureConflicts(getFeaturesForPlan(plan))).toEqual([])
    }
    expect(getHrmsFeatureConflicts(mergeCompanyFeatures({ fullAndFinal: true }, 'budget'))).toEqual([])
  })

  test('maps legacy API families to the same module gates as the UI', () => {
    expect(getApiFeatureRule('/api/payroll/generate')).toMatchObject({ allOf: ['payroll'] })
    expect(getApiFeatureRule('/api/meetings/abc/transcript')).toMatchObject({ allOf: ['meetings'] })
    expect(getApiFeatureRule('/api/company/features')).toBeNull()
  })
})
