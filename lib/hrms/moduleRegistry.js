/**
 * Canonical HRMS module registry.
 *
 * This is intentionally framework-free so it can be used by Super Admin UI,
 * tenant API guards, migrations and tests without creating competing module
 * lists. `featureKey` is the persisted TenantCompany feature flag.
 */
export const HRMS_MODULES = [
  { key: 'manpowerPlanning', label: 'Manpower Planning', phase: 'plan', dependencies: [] },
  { key: 'mrfWorkflow', label: 'Manpower Requisition (MRF)', phase: 'plan', dependencies: ['manpowerPlanning'] },
  { key: 'recruitment', label: 'Recruitment & ATS', phase: 'hire', dependencies: ['mrfWorkflow'] },
  { key: 'interviews', label: 'Interview Management', phase: 'hire', dependencies: ['recruitment'] },
  { key: 'offers', label: 'Offer Management', phase: 'hire', dependencies: ['interviews'] },
  { key: 'preJoining', label: 'Pre-Joining', phase: 'join', dependencies: ['offers'] },
  { key: 'backgroundVerification', label: 'Background Verification', phase: 'join', dependencies: ['preJoining'] },
  { key: 'onboarding', label: 'Employee Onboarding', phase: 'join', dependencies: ['preJoining'] },
  { key: 'employees', label: 'Employee Profile', phase: 'operate', dependencies: ['onboarding'] },
  { key: 'assets', label: 'Asset Lifecycle', phase: 'operate', dependencies: ['employees'] },
  { key: 'departmentInduction', label: 'Department Induction', phase: 'join', dependencies: ['onboarding'] },
  { key: 'probation', label: 'Probation & Confirmation', phase: 'operate', dependencies: ['onboarding'] },
  { key: 'gpsAttendance', label: 'Attendance', phase: 'operate', dependencies: ['employees'] },
  { key: 'attendanceMachines', label: 'Attendance Machine Integrations', phase: 'operate', dependencies: ['gpsAttendance'] },
  { key: 'leaveManagement', label: 'Leave, WFH & Backdated Requests', phase: 'operate', dependencies: ['employees'] },
  { key: 'payroll', label: 'Payroll, PF & ESIC', phase: 'operate', dependencies: ['employees', 'gpsAttendance'] },
  { key: 'performance', label: 'Performance, KRA & KPI', phase: 'grow', dependencies: ['employees'] },
  { key: 'learning', label: 'Learning & Development', phase: 'grow', dependencies: ['employees'] },
  { key: 'internalJobPosting', label: 'Internal Job Posting', phase: 'grow', dependencies: ['employees', 'recruitment'] },
  { key: 'transfers', label: 'Transfers', phase: 'operate', dependencies: ['employees'] },
  { key: 'rewards', label: 'Rewards & Recognition', phase: 'grow', dependencies: ['employees'] },
  { key: 'engagement', label: 'Employee Engagement', phase: 'grow', dependencies: ['employees'] },
  { key: 'travel', label: 'Travel & Claims', phase: 'operate', dependencies: ['employees'] },
  { key: 'helpdesk', label: 'Employee Helpdesk', phase: 'operate', dependencies: ['employees'] },
  { key: 'disciplinary', label: 'Disciplinary Actions', phase: 'govern', dependencies: ['employees'] },
  { key: 'posh', label: 'POSH Case Management', phase: 'govern', dependencies: ['employees'] },
  { key: 'documents', label: 'Document Management', phase: 'govern', dependencies: ['employees'] },
  { key: 'exitManagement', label: 'Exit Management', phase: 'exit', dependencies: ['employees'] },
  { key: 'fullAndFinal', label: 'Full & Final Settlement', phase: 'exit', dependencies: ['exitManagement', 'payroll'] },
  { key: 'experienceLetters', label: 'Experience Letters', phase: 'exit', dependencies: ['exitManagement'] },
  { key: 'alumni', label: 'Alumni', phase: 'exit', dependencies: ['exitManagement'] },
]

export const HRMS_PHASES = {
  plan: { label: 'Plan', description: 'Workforce demand and approvals' },
  hire: { label: 'Hire', description: 'Recruitment through offer' },
  join: { label: 'Join', description: 'Pre-joining, verification and onboarding' },
  operate: { label: 'Operate', description: 'Core employee operations' },
  grow: { label: 'Grow', description: 'Performance and development' },
  govern: { label: 'Govern', description: 'Policy, support and compliance' },
  exit: { label: 'Exit', description: 'Separation through alumni' },
}

export const HRMS_MODULE_KEYS = HRMS_MODULES.map(({ key }) => key)
export const HRMS_MODULE_BY_KEY = Object.fromEntries(HRMS_MODULES.map((module) => [module.key, module]))

export const HRMS_MODULE_FIELDS = {
  manpowerPlanning: ['department', 'fiscalPeriod', 'plannedHeadcount'],
  mrfWorkflow: ['department', 'roleTitle', 'headcount', 'justification'],
  recruitment: ['roleTitle'], interviews: ['candidateName', 'scheduledAt'],
  offers: ['candidateName', 'compensation'], preJoining: ['candidateName', 'joiningDate'],
  backgroundVerification: ['candidateName'], onboarding: ['employeeName', 'joiningDate'],
  assets: ['assetName'], departmentInduction: ['department'], probation: ['reviewDate'],
  leaveManagement: ['startDate', 'endDate'], payroll: ['payrollPeriod'],
  performance: ['reviewPeriod'], learning: ['courseName'], internalJobPosting: ['roleTitle'],
  transfers: ['targetDepartment'], rewards: ['reason'], engagement: ['initiative'],
  travel: ['destination', 'startDate', 'endDate'], helpdesk: ['issue'],
  disciplinary: ['allegation'], posh: ['complaint'], documents: ['documentType'],
  exitManagement: ['lastWorkingDay', 'reason'], fullAndFinal: ['settlementDate'],
  experienceLetters: ['lastWorkingDay'], alumni: ['contactConsent'],
}

export function humanizeHrmsField(field) {
  return String(field).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase())
}

export const PRIMARY_HRMS_LIFECYCLE = [
  'manpowerPlanning', 'mrfWorkflow', 'recruitment', 'interviews', 'offers',
  'preJoining', 'backgroundVerification', 'onboarding', 'employees',
  'gpsAttendance', 'attendanceMachines', 'leaveManagement', 'payroll', 'performance', 'learning',
  'exitManagement', 'fullAndFinal', 'experienceLetters', 'alumni',
]

export function getNextHrmsModule(featureKey) {
  const position = PRIMARY_HRMS_LIFECYCLE.indexOf(featureKey)
  return position >= 0 ? PRIMARY_HRMS_LIFECYCLE[position + 1] || null : null
}

const reverseDependencies = HRMS_MODULES.reduce((result, module) => {
  for (const dependency of module.dependencies) {
    if (!result[dependency]) result[dependency] = []
    result[dependency].push(module.key)
  }
  return result
}, {})

function visitDependencies(featureKey, output, visiting = new Set()) {
  if (visiting.has(featureKey)) {
    throw new Error(`Circular HRMS feature dependency detected at ${featureKey}`)
  }
  visiting.add(featureKey)
  for (const dependency of HRMS_MODULE_BY_KEY[featureKey]?.dependencies || []) {
    output.add(dependency)
    visitDependencies(dependency, output, visiting)
  }
  visiting.delete(featureKey)
}

function visitDependents(featureKey, output) {
  for (const dependent of reverseDependencies[featureKey] || []) {
    if (output.has(dependent)) continue
    output.add(dependent)
    visitDependents(dependent, output)
  }
}

/**
 * Toggle one workflow module while preserving a valid dependency graph.
 * Enabling turns on prerequisites; disabling turns off downstream modules.
 */
export function toggleHrmsModule(features, featureKey, enabled) {
  if (!HRMS_MODULE_BY_KEY[featureKey]) return { ...features }

  const next = { ...features, [featureKey]: enabled }
  const affected = new Set()
  if (enabled) {
    visitDependencies(featureKey, affected)
    for (const dependency of affected) next[dependency] = true
  } else {
    visitDependents(featureKey, affected)
    for (const dependent of affected) next[dependent] = false
  }
  return next
}

/**
 * Normalise arbitrary persisted/input flags. Enabled modules always have all
 * prerequisites enabled. Unknown flags are preserved for forward compatibility.
 */
export function normalizeHrmsFeatures(features = {}) {
  let normalized = { ...features }
  for (const module of HRMS_MODULES) {
    if (normalized[module.key] === true) {
      normalized = toggleHrmsModule(normalized, module.key, true)
    }
  }
  return normalized
}

export function getHrmsFeatureConflicts(features = {}) {
  const conflicts = []
  for (const module of HRMS_MODULES) {
    if (features[module.key] !== true) continue
    const missing = module.dependencies.filter((dependency) => features[dependency] !== true)
    if (missing.length) conflicts.push({ featureKey: module.key, missing })
  }
  return conflicts
}

export function getHrmsModulesByPhase() {
  return Object.fromEntries(Object.keys(HRMS_PHASES).map((phase) => [
    phase,
    HRMS_MODULES.filter((module) => module.phase === phase),
  ]))
}
