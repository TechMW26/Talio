import fs from 'fs'
import path from 'path'
import { roleBasedMenus } from '@/utils/roleBasedMenus'
import { WIDGET_REGISTRY } from '@/lib/widgetRegistry'
import { ALL_FEATURE_KEYS, getFeaturesForPlan } from '@/lib/planFeatures'
import { HRMS_MODULE_KEYS, HRMS_MODULE_FIELDS, PRIMARY_HRMS_LIFECYCLE, getNextHrmsModule } from '@/lib/hrms/moduleRegistry'
import { SYSTEM_ROLE_DEFINITIONS } from '@/lib/systemRoles'
import { renderHook } from '@testing-library/react'
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets'

test('LMS pages and widget source are removed', () => {
  for (const file of [
    'app/dashboard/learning/page.js', 'app/dashboard/learning/courses/page.js',
    'app/dashboard/learning/trainings/page.js', 'app/dashboard/learning/certificates/page.js',
    'components/widgets/LearningProgressWidget.js',
  ]) expect(fs.existsSync(path.join(process.cwd(), file))).toBe(false)
})

test('LMS is absent from navigation, plans, workflows and widgets', () => {
  expect(JSON.stringify(roleBasedMenus)).not.toContain('/dashboard/learning')
  expect(WIDGET_REGISTRY).not.toHaveProperty('learning-progress')
  expect(ALL_FEATURE_KEYS).not.toContain('learning')
  expect(HRMS_MODULE_KEYS).not.toContain('learning')
  expect(HRMS_MODULE_FIELDS).not.toHaveProperty('learning')
  expect(PRIMARY_HRMS_LIFECYCLE).not.toContain('learning')
  expect(getNextHrmsModule('performance')).toBe('exitManagement')
  for (const plan of ['budget', 'starter', 'professional', 'enterprise', 'trial', 'custom']) {
    expect(getFeaturesForPlan(plan)).not.toHaveProperty('learning')
  }
})

test('LMS has no remaining route maps or permission grants', () => {
  for (const file of ['lib/miraAppMap.generated.json', 'lib/miraAppRoutes.generated.json', 'lib/permissions.shared.js', 'components/RoleBasedAccess.js']) {
    expect(fs.readFileSync(path.join(process.cwd(), file), 'utf8')).not.toContain('/dashboard/learning')
  }
  for (const role of Object.values(SYSTEM_ROLE_DEFINITIONS)) {
    expect(role.buildPermissions()).not.toHaveProperty('learning')
    expect(role.buildPermissions()).not.toHaveProperty('undefined')
  }
})

test('saved layouts safely discard retired LMS widgets', () => {
  localStorage.setItem('dashboard_widgets_config_lms-removal', JSON.stringify({
    enabled: ['check-in-out', 'learning-progress'], order: ['check-in-out', 'learning-progress'], gridVersion: 2,
  }))
  const { result } = renderHook(() => useDashboardWidgets('lms-removal', 'employee', ['check-in-out']))
  expect(result.current.enabledWidgets).toEqual(['check-in-out'])
  expect(result.current.widgetOrder).toEqual(['check-in-out'])
  localStorage.removeItem('dashboard_widgets_config_lms-removal')
})
