/**
 * lib/permissions.shared.js
 *
 * Client-safe RBAC constants and pure utility functions.
 * Safe to import from client components, hooks, and utils.
 * For server-only functions (resolveUserPermissions, requirePermission, etc.)
 * import from lib/permissions.js instead.
 */

// ---------------------------------------------------------------------------
// 1. PAGE_SLUGS — unique identifier for every protected dashboard page
// ---------------------------------------------------------------------------
export const PAGE_SLUGS = {
  // Dashboard
  DASHBOARD: 'dashboard',

  // Employees
  EMPLOYEES: 'employees',
  EMPLOYEES_ADD: 'employees_add',
  EMPLOYEES_EDIT: 'employees_edit',
  EMPLOYEES_PASSWORDS: 'employees_passwords',
  EMPLOYEES_ONBOARDING: 'employees_onboarding',

  // Attendance
  ATTENDANCE_PERSONAL: 'attendance_personal',
  ATTENDANCE_TEAM: 'attendance_team',
  ATTENDANCE_CHECKINS: 'attendance_checkins',
  ATTENDANCE_REPORT: 'attendance_report',
  ATTENDANCE_CORRECTIONS: 'attendance_corrections',
  ATTENDANCE_REGULARISATION: 'attendance_regularisation',

  // Leave
  LEAVE_PERSONAL: 'leave_personal',
  LEAVE_APPLY: 'leave_apply',
  LEAVE_REQUESTS: 'leave_requests',
  LEAVE_APPROVALS: 'leave_approvals',
  LEAVE_ALLOCATIONS: 'leave_allocations',
  LEAVE_TYPES: 'leave_types',
  LEAVE_BALANCE: 'leave_balance',
  LEAVE_WORK_FROM_HOME: 'leave_work_from_home',
  LEAVE_EARLY_LEAVE: 'leave_early_leave',

  // Payroll
  PAYROLL: 'payroll',
  PAYROLL_GENERATE: 'payroll_generate',
  PAYROLL_PAYSLIPS: 'payroll_payslips',

  // Projects & Tasks
  PROJECTS: 'projects',
  PROJECTS_CREATE: 'projects_create',
  PROJECTS_EDIT: 'projects_edit',
  PROJECTS_APPROVALS: 'projects_approvals',
  TASKS: 'tasks',
  TASKS_ASSIGNED: 'tasks_assigned',

  // Performance
  PERFORMANCE: 'performance',
  PERFORMANCE_MY: 'performance_my',
  PERFORMANCE_RATINGS: 'performance_ratings',
  PERFORMANCE_REPORTS: 'performance_reports',
  PERFORMANCE_GOALS: 'performance_goals',
  PERFORMANCE_GOALS_CREATE: 'performance_goals_create',

  // Recruitment
  RECRUITMENT: 'recruitment',
  RECRUITMENT_CANDIDATES: 'recruitment_candidates',
  RECRUITMENT_INTERVIEWS: 'recruitment_interviews',
  RECRUITMENT_ANALYTICS: 'recruitment_analytics',

  // Helpdesk
  HELPDESK: 'helpdesk',
  HELPDESK_MANAGE: 'helpdesk_manage',

  // Learning
  LEARNING: 'learning',

  // Communication
  CHAT: 'chat',
  MEETINGS: 'meetings',
  ANNOUNCEMENTS: 'announcements',
  ANNOUNCEMENTS_CREATE: 'announcements_create',
  MAIL: 'mail',

  // Calendar & Company
  CALENDAR: 'calendar',
  HOLIDAYS: 'holidays',

  // Resources
  DOCUMENTS: 'documents',
  EXPENSES: 'expenses',
  EXPENSES_APPROVALS: 'expenses_approvals',
  ASSETS: 'assets',

  // Organization
  DESIGNATIONS: 'designations',
  DEPARTMENTS: 'departments',

  // Productivity & Monitoring
  PRODUCTIVITY: 'productivity',
  LIVE_USERS: 'live_users',

  // Misc
  REPORTS: 'reports',
  TODO: 'todo',
  TALIOBOARD: 'talioboard',
  SANDBOX: 'sandbox',
  POLICIES: 'policies',

  // Settings
  SETTINGS: 'settings',
  SETTINGS_PREFERENCES: 'settings_preferences',
  SETTINGS_NOTIFICATIONS: 'settings_notifications',
  SETTINGS_GEOFENCE: 'settings_geofence',

  // Team
  TEAM_MEMBERS: 'team_members',

  // Whiteboard
  WHITEBOARD: 'whiteboard',

  // RBAC Administration
  RBAC_ROLES: 'rbac_roles',
}

// ---------------------------------------------------------------------------
// 2. ACTIONS — every possible granular action type
// ---------------------------------------------------------------------------
export const ACTIONS = {
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit',
  DELETE: 'delete',
  EXPORT: 'export',
  APPROVE: 'approve',
  REJECT: 'reject',
  ASSIGN: 'assign',
  MANAGE: 'manage',
}

// ---------------------------------------------------------------------------
// 3. PERMISSIONS_SCHEMA — maps each slug to the actions relevant to that page
//    Not every page needs every action. Only what makes functional sense.
// ---------------------------------------------------------------------------
export const PERMISSIONS_SCHEMA = {
  // Dashboard
  [PAGE_SLUGS.DASHBOARD]: [ACTIONS.VIEW],

  // Employees
  [PAGE_SLUGS.EMPLOYEES]: [ACTIONS.VIEW, ACTIONS.EXPORT],
  [PAGE_SLUGS.EMPLOYEES_ADD]: [ACTIONS.VIEW, ACTIONS.CREATE],
  [PAGE_SLUGS.EMPLOYEES_EDIT]: [ACTIONS.VIEW, ACTIONS.EDIT, ACTIONS.DELETE],
  [PAGE_SLUGS.EMPLOYEES_PASSWORDS]: [ACTIONS.VIEW, ACTIONS.MANAGE],
  [PAGE_SLUGS.EMPLOYEES_ONBOARDING]: [ACTIONS.VIEW, ACTIONS.MANAGE],

  // Attendance
  [PAGE_SLUGS.ATTENDANCE_PERSONAL]: [ACTIONS.VIEW],
  [PAGE_SLUGS.ATTENDANCE_TEAM]: [ACTIONS.VIEW, ACTIONS.EXPORT],
  [PAGE_SLUGS.ATTENDANCE_CHECKINS]: [ACTIONS.VIEW, ACTIONS.EXPORT],
  [PAGE_SLUGS.ATTENDANCE_REPORT]: [ACTIONS.VIEW, ACTIONS.EXPORT],
  [PAGE_SLUGS.ATTENDANCE_CORRECTIONS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.APPROVE, ACTIONS.REJECT],
  [PAGE_SLUGS.ATTENDANCE_REGULARISATION]: [ACTIONS.VIEW, ACTIONS.APPROVE, ACTIONS.REJECT],

  // Leave
  [PAGE_SLUGS.LEAVE_PERSONAL]: [ACTIONS.VIEW],
  [PAGE_SLUGS.LEAVE_APPLY]: [ACTIONS.VIEW, ACTIONS.CREATE],
  [PAGE_SLUGS.LEAVE_REQUESTS]: [ACTIONS.VIEW, ACTIONS.DELETE],
  [PAGE_SLUGS.LEAVE_APPROVALS]: [ACTIONS.VIEW, ACTIONS.APPROVE, ACTIONS.REJECT],
  [PAGE_SLUGS.LEAVE_ALLOCATIONS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT],
  [PAGE_SLUGS.LEAVE_TYPES]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [PAGE_SLUGS.LEAVE_BALANCE]: [ACTIONS.VIEW],
  [PAGE_SLUGS.LEAVE_WORK_FROM_HOME]: [ACTIONS.VIEW, ACTIONS.CREATE],
  [PAGE_SLUGS.LEAVE_EARLY_LEAVE]: [ACTIONS.VIEW, ACTIONS.CREATE],

  // Payroll
  [PAGE_SLUGS.PAYROLL]: [ACTIONS.VIEW, ACTIONS.MANAGE],
  [PAGE_SLUGS.PAYROLL_GENERATE]: [ACTIONS.VIEW, ACTIONS.CREATE],
  [PAGE_SLUGS.PAYROLL_PAYSLIPS]: [ACTIONS.VIEW, ACTIONS.EXPORT],

  // Projects & Tasks
  [PAGE_SLUGS.PROJECTS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [PAGE_SLUGS.PROJECTS_CREATE]: [ACTIONS.VIEW, ACTIONS.CREATE],
  [PAGE_SLUGS.PROJECTS_EDIT]: [ACTIONS.VIEW, ACTIONS.EDIT],
  [PAGE_SLUGS.PROJECTS_APPROVALS]: [ACTIONS.VIEW, ACTIONS.APPROVE, ACTIONS.REJECT],
  [PAGE_SLUGS.TASKS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.ASSIGN],
  [PAGE_SLUGS.TASKS_ASSIGNED]: [ACTIONS.VIEW],

  // Performance
  [PAGE_SLUGS.PERFORMANCE]: [ACTIONS.VIEW],
  [PAGE_SLUGS.PERFORMANCE_MY]: [ACTIONS.VIEW],
  [PAGE_SLUGS.PERFORMANCE_RATINGS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT],
  [PAGE_SLUGS.PERFORMANCE_REPORTS]: [ACTIONS.VIEW, ACTIONS.EXPORT],
  [PAGE_SLUGS.PERFORMANCE_GOALS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [PAGE_SLUGS.PERFORMANCE_GOALS_CREATE]: [ACTIONS.VIEW, ACTIONS.CREATE],

  // Recruitment
  [PAGE_SLUGS.RECRUITMENT]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [PAGE_SLUGS.RECRUITMENT_CANDIDATES]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT],
  [PAGE_SLUGS.RECRUITMENT_INTERVIEWS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT],
  [PAGE_SLUGS.RECRUITMENT_ANALYTICS]: [ACTIONS.VIEW, ACTIONS.EXPORT],

  // Helpdesk
  [PAGE_SLUGS.HELPDESK]: [ACTIONS.VIEW, ACTIONS.CREATE],
  [PAGE_SLUGS.HELPDESK_MANAGE]: [ACTIONS.VIEW, ACTIONS.EDIT, ACTIONS.ASSIGN, ACTIONS.DELETE],

  // Learning
  [PAGE_SLUGS.LEARNING]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],

  // Communication
  [PAGE_SLUGS.CHAT]: [ACTIONS.VIEW, ACTIONS.CREATE],
  [PAGE_SLUGS.MEETINGS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [PAGE_SLUGS.ANNOUNCEMENTS]: [ACTIONS.VIEW],
  [PAGE_SLUGS.ANNOUNCEMENTS_CREATE]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [PAGE_SLUGS.MAIL]: [ACTIONS.VIEW],

  // Calendar & Company
  [PAGE_SLUGS.CALENDAR]: [ACTIONS.VIEW],
  [PAGE_SLUGS.HOLIDAYS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],

  // Resources
  [PAGE_SLUGS.DOCUMENTS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.DELETE],
  [PAGE_SLUGS.EXPENSES]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [PAGE_SLUGS.EXPENSES_APPROVALS]: [ACTIONS.VIEW, ACTIONS.APPROVE, ACTIONS.REJECT],
  [PAGE_SLUGS.ASSETS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],

  // Organization
  [PAGE_SLUGS.DESIGNATIONS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [PAGE_SLUGS.DEPARTMENTS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],

  // Productivity & Monitoring
  [PAGE_SLUGS.PRODUCTIVITY]: [ACTIONS.VIEW],
  [PAGE_SLUGS.LIVE_USERS]: [ACTIONS.VIEW],

  // Misc
  [PAGE_SLUGS.REPORTS]: [ACTIONS.VIEW, ACTIONS.EXPORT],
  [PAGE_SLUGS.TODO]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [PAGE_SLUGS.TALIOBOARD]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [PAGE_SLUGS.SANDBOX]: [ACTIONS.VIEW, ACTIONS.CREATE],
  [PAGE_SLUGS.POLICIES]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],

  // Settings
  [PAGE_SLUGS.SETTINGS]: [ACTIONS.VIEW, ACTIONS.MANAGE],
  [PAGE_SLUGS.SETTINGS_PREFERENCES]: [ACTIONS.VIEW, ACTIONS.EDIT],
  [PAGE_SLUGS.SETTINGS_NOTIFICATIONS]: [ACTIONS.VIEW, ACTIONS.EDIT],
  [PAGE_SLUGS.SETTINGS_GEOFENCE]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],

  // Team
  [PAGE_SLUGS.TEAM_MEMBERS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.ASSIGN],

  // Whiteboard
  [PAGE_SLUGS.WHITEBOARD]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],

  // RBAC Administration
  [PAGE_SLUGS.RBAC_ROLES]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
}

// ---------------------------------------------------------------------------
// 4. PAGE_SLUG_META — display metadata for Role Builder UI
//    Categories match sidebar groups from the audit.
// ---------------------------------------------------------------------------
export const CATEGORIES = {
  MAIN: 'Main',
  ATTENDANCE_LEAVES: 'Attendance & Leaves',
  PAYROLL: 'Payroll',
  PROJECTS_TASKS: 'Projects & Tasks',
  PERFORMANCE: 'Performance',
  PEOPLE_RECRUITMENT: 'People & Recruitment',
  COMMUNICATION: 'Communication',
  RESOURCES: 'Resources',
  COMPANY: 'Company',
  ADMINISTRATION: 'Administration',
}

export const PAGE_SLUG_META = {
  [PAGE_SLUGS.DASHBOARD]: { label: 'Dashboard', category: CATEGORIES.MAIN },
  [PAGE_SLUGS.CHAT]: { label: 'Chat', category: CATEGORIES.COMMUNICATION },
  [PAGE_SLUGS.MAIL]: { label: 'Mail', category: CATEGORIES.COMMUNICATION },
  [PAGE_SLUGS.MEETINGS]: { label: 'Meetings', category: CATEGORIES.COMMUNICATION },
  [PAGE_SLUGS.TODO]: { label: 'To-Do\'s', category: CATEGORIES.MAIN },
  [PAGE_SLUGS.TALIOBOARD]: { label: 'TalioBoard', category: CATEGORIES.MAIN },

  // Attendance & Leaves
  [PAGE_SLUGS.ATTENDANCE_PERSONAL]: { label: 'My Attendance', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.ATTENDANCE_TEAM]: { label: 'Team Attendance', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.ATTENDANCE_CHECKINS]: { label: 'Employee Check-ins', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.ATTENDANCE_REPORT]: { label: 'Attendance Report', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.ATTENDANCE_CORRECTIONS]: { label: 'Attendance Corrections', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.ATTENDANCE_REGULARISATION]: { label: 'Attendance Regularisation', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.LEAVE_PERSONAL]: { label: 'Leave Dashboard', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.LEAVE_APPLY]: { label: 'Apply Leave', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.LEAVE_REQUESTS]: { label: 'My Leave Requests', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.LEAVE_APPROVALS]: { label: 'Leave Approvals', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.LEAVE_ALLOCATIONS]: { label: 'Leave Allocations', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.LEAVE_TYPES]: { label: 'Leave Types', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.LEAVE_BALANCE]: { label: 'Leave Balance', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.LEAVE_WORK_FROM_HOME]: { label: 'Work From Home', category: CATEGORIES.ATTENDANCE_LEAVES },
  [PAGE_SLUGS.LEAVE_EARLY_LEAVE]: { label: 'Early Leave', category: CATEGORIES.ATTENDANCE_LEAVES },

  // Payroll
  [PAGE_SLUGS.PAYROLL]: { label: 'Process Payroll', category: CATEGORIES.PAYROLL },
  [PAGE_SLUGS.PAYROLL_GENERATE]: { label: 'Generate Payslips', category: CATEGORIES.PAYROLL },
  [PAGE_SLUGS.PAYROLL_PAYSLIPS]: { label: 'Payslips', category: CATEGORIES.PAYROLL },

  // Projects & Tasks
  [PAGE_SLUGS.PROJECTS]: { label: 'All Projects', category: CATEGORIES.PROJECTS_TASKS },
  [PAGE_SLUGS.PROJECTS_CREATE]: { label: 'Create Project', category: CATEGORIES.PROJECTS_TASKS },
  [PAGE_SLUGS.PROJECTS_EDIT]: { label: 'Edit Project', category: CATEGORIES.PROJECTS_TASKS },
  [PAGE_SLUGS.PROJECTS_APPROVALS]: { label: 'Project Approvals', category: CATEGORIES.PROJECTS_TASKS },
  [PAGE_SLUGS.TASKS]: { label: 'My Tasks', category: CATEGORIES.PROJECTS_TASKS },
  [PAGE_SLUGS.TASKS_ASSIGNED]: { label: 'Assigned Tasks', category: CATEGORIES.PROJECTS_TASKS },

  // Performance
  [PAGE_SLUGS.PERFORMANCE]: { label: 'Performance Overview', category: CATEGORIES.PERFORMANCE },
  [PAGE_SLUGS.PERFORMANCE_MY]: { label: 'My Performance', category: CATEGORIES.PERFORMANCE },
  [PAGE_SLUGS.PERFORMANCE_RATINGS]: { label: 'Employee Ratings', category: CATEGORIES.PERFORMANCE },
  [PAGE_SLUGS.PERFORMANCE_REPORTS]: { label: 'Performance Reports', category: CATEGORIES.PERFORMANCE },
  [PAGE_SLUGS.PERFORMANCE_GOALS]: { label: 'Goals & Objectives', category: CATEGORIES.PERFORMANCE },
  [PAGE_SLUGS.PERFORMANCE_GOALS_CREATE]: { label: 'Create Goal', category: CATEGORIES.PERFORMANCE },

  // People & Recruitment
  [PAGE_SLUGS.EMPLOYEES]: { label: 'All Employees', category: CATEGORIES.PEOPLE_RECRUITMENT },
  [PAGE_SLUGS.EMPLOYEES_ADD]: { label: 'Add Employee', category: CATEGORIES.PEOPLE_RECRUITMENT },
  [PAGE_SLUGS.EMPLOYEES_EDIT]: { label: 'Edit Employee', category: CATEGORIES.PEOPLE_RECRUITMENT },
  [PAGE_SLUGS.EMPLOYEES_PASSWORDS]: { label: 'User Passwords', category: CATEGORIES.PEOPLE_RECRUITMENT },
  [PAGE_SLUGS.EMPLOYEES_ONBOARDING]: { label: 'Onboarding Emails', category: CATEGORIES.PEOPLE_RECRUITMENT },
  [PAGE_SLUGS.DESIGNATIONS]: { label: 'Designations', category: CATEGORIES.PEOPLE_RECRUITMENT },
  [PAGE_SLUGS.DEPARTMENTS]: { label: 'Departments', category: CATEGORIES.PEOPLE_RECRUITMENT },
  [PAGE_SLUGS.TEAM_MEMBERS]: { label: 'Team Members', category: CATEGORIES.PEOPLE_RECRUITMENT },
  [PAGE_SLUGS.RECRUITMENT]: { label: 'Job Openings', category: CATEGORIES.PEOPLE_RECRUITMENT },
  [PAGE_SLUGS.RECRUITMENT_CANDIDATES]: { label: 'Candidates', category: CATEGORIES.PEOPLE_RECRUITMENT },
  [PAGE_SLUGS.RECRUITMENT_INTERVIEWS]: { label: 'Interviews', category: CATEGORIES.PEOPLE_RECRUITMENT },
  [PAGE_SLUGS.RECRUITMENT_ANALYTICS]: { label: 'Recruitment Analytics', category: CATEGORIES.PEOPLE_RECRUITMENT },

  // Communication
  [PAGE_SLUGS.ANNOUNCEMENTS]: { label: 'Announcements', category: CATEGORIES.COMMUNICATION },
  [PAGE_SLUGS.ANNOUNCEMENTS_CREATE]: { label: 'Create Announcement', category: CATEGORIES.COMMUNICATION },

  // Resources
  [PAGE_SLUGS.DOCUMENTS]: { label: 'Documents', category: CATEGORIES.RESOURCES },
  [PAGE_SLUGS.EXPENSES]: { label: 'My Expenses', category: CATEGORIES.RESOURCES },
  [PAGE_SLUGS.EXPENSES_APPROVALS]: { label: 'Expense Approvals', category: CATEGORIES.RESOURCES },
  [PAGE_SLUGS.ASSETS]: { label: 'Assets', category: CATEGORIES.RESOURCES },
  [PAGE_SLUGS.HELPDESK]: { label: 'Helpdesk', category: CATEGORIES.RESOURCES },
  [PAGE_SLUGS.HELPDESK_MANAGE]: { label: 'Manage Tickets', category: CATEGORIES.RESOURCES },
  [PAGE_SLUGS.POLICIES]: { label: 'Policies', category: CATEGORIES.RESOURCES },
  [PAGE_SLUGS.LEARNING]: { label: 'Learning & Development', category: CATEGORIES.RESOURCES },
  [PAGE_SLUGS.SANDBOX]: { label: 'Ideas', category: CATEGORIES.RESOURCES },
  [PAGE_SLUGS.WHITEBOARD]: { label: 'Whiteboard', category: CATEGORIES.RESOURCES },

  // Company
  [PAGE_SLUGS.CALENDAR]: { label: 'General Calendar', category: CATEGORIES.COMPANY },
  [PAGE_SLUGS.HOLIDAYS]: { label: 'Holidays', category: CATEGORIES.COMPANY },
  [PAGE_SLUGS.REPORTS]: { label: 'Reports', category: CATEGORIES.COMPANY },
  [PAGE_SLUGS.PRODUCTIVITY]: { label: 'Productivity', category: CATEGORIES.COMPANY },
  [PAGE_SLUGS.LIVE_USERS]: { label: 'Live Users', category: CATEGORIES.COMPANY },

  // Administration
  [PAGE_SLUGS.SETTINGS]: { label: 'Settings Hub', category: CATEGORIES.ADMINISTRATION },
  [PAGE_SLUGS.SETTINGS_PREFERENCES]: { label: 'Company Preferences', category: CATEGORIES.ADMINISTRATION },
  [PAGE_SLUGS.SETTINGS_NOTIFICATIONS]: { label: 'Notification Rules', category: CATEGORIES.ADMINISTRATION },
  [PAGE_SLUGS.SETTINGS_GEOFENCE]: { label: 'Geofence Locations', category: CATEGORIES.ADMINISTRATION },
  [PAGE_SLUGS.RBAC_ROLES]: { label: 'Role Management', category: CATEGORIES.ADMINISTRATION },
}

// ---------------------------------------------------------------------------
// 5. PATH_TO_SLUG — maps dashboard URL paths to page slugs
//    Used by sidebar filtering and client-side route guards.
//    Dynamic segments ([id], [projectId], etc.) are handled via prefix matching
//    in getPageSlugForPath().
// ---------------------------------------------------------------------------
export const PATH_TO_SLUG = {
  '/dashboard': PAGE_SLUGS.DASHBOARD,

  // Employees
  '/dashboard/employees': PAGE_SLUGS.EMPLOYEES,
  '/dashboard/employees/add': PAGE_SLUGS.EMPLOYEES_ADD,
  '/dashboard/employees/edit': PAGE_SLUGS.EMPLOYEES_EDIT,
  '/dashboard/employees/user-passwords': PAGE_SLUGS.EMPLOYEES_PASSWORDS,
  '/dashboard/employees/onboarding-emails': PAGE_SLUGS.EMPLOYEES_ONBOARDING,

  // Attendance
  '/dashboard/attendance': PAGE_SLUGS.ATTENDANCE_PERSONAL,
  '/dashboard/attendance/team': PAGE_SLUGS.ATTENDANCE_TEAM,
  '/dashboard/attendance/checkins': PAGE_SLUGS.ATTENDANCE_CHECKINS,
  '/dashboard/attendance/report': PAGE_SLUGS.ATTENDANCE_REPORT,

  // Corrections & Regularisation (under team in url but attendance in function)
  '/dashboard/team/regularisation': PAGE_SLUGS.ATTENDANCE_REGULARISATION,

  // Leave
  '/dashboard/leave': PAGE_SLUGS.LEAVE_PERSONAL,
  '/dashboard/leave/apply': PAGE_SLUGS.LEAVE_APPLY,
  '/dashboard/leave/requests': PAGE_SLUGS.LEAVE_REQUESTS,
  '/dashboard/leave/approvals': PAGE_SLUGS.LEAVE_APPROVALS,
  '/dashboard/leave/allocations': PAGE_SLUGS.LEAVE_ALLOCATIONS,
  '/dashboard/leave/balance': PAGE_SLUGS.LEAVE_BALANCE,
  '/dashboard/leave/work-from-home': PAGE_SLUGS.LEAVE_WORK_FROM_HOME,
  '/dashboard/leave/early-leave': PAGE_SLUGS.LEAVE_EARLY_LEAVE,
  '/dashboard/leave-types': PAGE_SLUGS.LEAVE_TYPES,

  // Payroll
  '/dashboard/payroll': PAGE_SLUGS.PAYROLL,
  '/dashboard/payroll/generate': PAGE_SLUGS.PAYROLL_GENERATE,
  '/dashboard/payroll/payslips': PAGE_SLUGS.PAYROLL_PAYSLIPS,

  // Projects
  '/dashboard/projects': PAGE_SLUGS.PROJECTS,
  '/dashboard/projects/create': PAGE_SLUGS.PROJECTS_CREATE,
  '/dashboard/projects/my-tasks': PAGE_SLUGS.TASKS,
  '/dashboard/projects/assigned-tasks': PAGE_SLUGS.TASKS_ASSIGNED,
  '/dashboard/projects/approvals': PAGE_SLUGS.PROJECTS_APPROVALS,

  // Performance
  '/dashboard/performance': PAGE_SLUGS.PERFORMANCE,
  '/dashboard/performance/my-performance': PAGE_SLUGS.PERFORMANCE_MY,
  '/dashboard/performance/ratings': PAGE_SLUGS.PERFORMANCE_RATINGS,
  '/dashboard/performance/reports': PAGE_SLUGS.PERFORMANCE_REPORTS,
  '/dashboard/performance/goals': PAGE_SLUGS.PERFORMANCE_GOALS,
  '/dashboard/performance/goals/create': PAGE_SLUGS.PERFORMANCE_GOALS_CREATE,

  // Recruitment
  '/dashboard/recruitment': PAGE_SLUGS.RECRUITMENT,
  '/dashboard/recruitment/candidates': PAGE_SLUGS.RECRUITMENT_CANDIDATES,
  '/dashboard/recruitment/interviews': PAGE_SLUGS.RECRUITMENT_INTERVIEWS,
  '/dashboard/recruitment/analytics': PAGE_SLUGS.RECRUITMENT_ANALYTICS,

  // Helpdesk
  '/dashboard/helpdesk': PAGE_SLUGS.HELPDESK,
  '/dashboard/helpdesk/manage': PAGE_SLUGS.HELPDESK_MANAGE,

  // Learning
  '/dashboard/learning': PAGE_SLUGS.LEARNING,
  '/dashboard/learning/courses': PAGE_SLUGS.LEARNING,
  '/dashboard/learning/trainings': PAGE_SLUGS.LEARNING,
  '/dashboard/learning/certificates': PAGE_SLUGS.LEARNING,

  // Communication
  '/dashboard/chat': PAGE_SLUGS.CHAT,
  '/dashboard/meetings': PAGE_SLUGS.MEETINGS,
  '/dashboard/announcements': PAGE_SLUGS.ANNOUNCEMENTS,
  '/dashboard/announcements/create': PAGE_SLUGS.ANNOUNCEMENTS_CREATE,
  '/dashboard/mail': PAGE_SLUGS.MAIL,

  // Calendar & Company
  '/dashboard/calendar': PAGE_SLUGS.CALENDAR,
  '/dashboard/holidays': PAGE_SLUGS.HOLIDAYS,

  // Resources
  '/dashboard/documents': PAGE_SLUGS.DOCUMENTS,
  '/dashboard/expenses': PAGE_SLUGS.EXPENSES,
  '/dashboard/expenses/approvals': PAGE_SLUGS.EXPENSES_APPROVALS,
  '/dashboard/assets': PAGE_SLUGS.ASSETS,

  // Organization
  '/dashboard/designations': PAGE_SLUGS.DESIGNATIONS,
  '/dashboard/departments': PAGE_SLUGS.DEPARTMENTS,

  // Productivity & Monitoring
  '/dashboard/productivity': PAGE_SLUGS.PRODUCTIVITY,
  '/dashboard/admin/live-users': PAGE_SLUGS.LIVE_USERS,

  // Misc
  '/dashboard/reports': PAGE_SLUGS.REPORTS,
  '/dashboard/todo': PAGE_SLUGS.TODO,
  '/dashboard/talioboard': PAGE_SLUGS.TALIOBOARD,
  '/dashboard/sandbox': PAGE_SLUGS.SANDBOX,
  '/dashboard/policies': PAGE_SLUGS.POLICIES,

  // Settings
  '/dashboard/settings': PAGE_SLUGS.SETTINGS,
  '/dashboard/settings/preferences': PAGE_SLUGS.SETTINGS_PREFERENCES,
  '/dashboard/settings/notifications': PAGE_SLUGS.SETTINGS_NOTIFICATIONS,
  '/dashboard/settings/geofence-locations': PAGE_SLUGS.SETTINGS_GEOFENCE,

  // Team
  '/dashboard/team/members': PAGE_SLUGS.TEAM_MEMBERS,

  // Whiteboard
  '/dashboard/whiteboard': PAGE_SLUGS.WHITEBOARD,

  // RBAC
  '/dashboard/rbac/roles': PAGE_SLUGS.RBAC_ROLES,

  // App-level pages that are always accessible (no slug needed)
  // /dashboard/app-info, /dashboard/fcm-diagnostic, /dashboard/sandbox
}

// Prefix rules for dynamic routes — checked when exact match fails.
// Order matters: longer prefixes first.
const DYNAMIC_PATH_PREFIXES = [
  { prefix: '/dashboard/projects/approvals/', slug: PAGE_SLUGS.PROJECTS_APPROVALS },
  { prefix: '/dashboard/projects/', slug: PAGE_SLUGS.PROJECTS },
  { prefix: '/dashboard/employees/edit/', slug: PAGE_SLUGS.EMPLOYEES_EDIT },
  { prefix: '/dashboard/employees/onboarding-emails/', slug: PAGE_SLUGS.EMPLOYEES_ONBOARDING },
  { prefix: '/dashboard/employees/', slug: PAGE_SLUGS.EMPLOYEES },
  { prefix: '/dashboard/attendance/', slug: PAGE_SLUGS.ATTENDANCE_PERSONAL },
  { prefix: '/dashboard/leave/', slug: PAGE_SLUGS.LEAVE_PERSONAL },
  { prefix: '/dashboard/payroll/payslips/', slug: PAGE_SLUGS.PAYROLL_PAYSLIPS },
  { prefix: '/dashboard/performance/goals/edit/', slug: PAGE_SLUGS.PERFORMANCE_GOALS },
  { prefix: '/dashboard/performance/goals/', slug: PAGE_SLUGS.PERFORMANCE_GOALS },
  { prefix: '/dashboard/performance/', slug: PAGE_SLUGS.PERFORMANCE },
  { prefix: '/dashboard/recruitment/candidates/', slug: PAGE_SLUGS.RECRUITMENT_CANDIDATES },
  { prefix: '/dashboard/recruitment/edit/', slug: PAGE_SLUGS.RECRUITMENT },
  { prefix: '/dashboard/recruitment/', slug: PAGE_SLUGS.RECRUITMENT },
  { prefix: '/dashboard/helpdesk/', slug: PAGE_SLUGS.HELPDESK },
  { prefix: '/dashboard/meetings/room/', slug: PAGE_SLUGS.MEETINGS },
  { prefix: '/dashboard/meetings/', slug: PAGE_SLUGS.MEETINGS },
  { prefix: '/dashboard/announcements/', slug: PAGE_SLUGS.ANNOUNCEMENTS },
  { prefix: '/dashboard/team/members/', slug: PAGE_SLUGS.TEAM_MEMBERS },
  { prefix: '/dashboard/whiteboard/', slug: PAGE_SLUGS.WHITEBOARD },
  { prefix: '/dashboard/learning/', slug: PAGE_SLUGS.LEARNING },
  { prefix: '/dashboard/rbac/', slug: PAGE_SLUGS.RBAC_ROLES },
]

// ---------------------------------------------------------------------------
// 6. Utility Functions
// ---------------------------------------------------------------------------

/**
 * Resolve a dashboard URL path to its page slug.
 * Returns null for paths that are always accessible or not mapped.
 */
export function getPageSlugForPath(pathname) {
  if (!pathname) return null

  // Strip trailing slash
  const path = pathname.endsWith('/') && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname

  // Exact match
  if (PATH_TO_SLUG[path]) {
    return PATH_TO_SLUG[path]
  }

  // Dynamic prefix match
  for (const { prefix, slug } of DYNAMIC_PATH_PREFIXES) {
    if (path.startsWith(prefix)) {
      return slug
    }
  }

  return null
}

/**
 * Build an empty permissions object from PERMISSIONS_SCHEMA.
 * Every action is set to false. Used as default for new roles.
 */
export function buildEmptyPermissions() {
  const permissions = {}
  for (const [slug, actions] of Object.entries(PERMISSIONS_SCHEMA)) {
    permissions[slug] = { canView: false }
    for (const action of actions) {
      if (action !== ACTIONS.VIEW) {
        permissions[slug][`can${action.charAt(0).toUpperCase()}${action.slice(1)}`] = false
      }
    }
  }
  return permissions
}

/**
 * Bring persisted permission documents forward to the current schema.
 *
 * Role documents can predate newly-added pages/actions. Editing one of those
 * roles should preserve its known values and fill only the missing entries,
 * rather than failing strict validation with "Missing page slug".
 * Unknown legacy entries are intentionally dropped so the saved document stays
 * aligned with the single source of truth in PERMISSIONS_SCHEMA.
 */
export function normalizePermissionsShape(permissions, fallbackPermissions = null) {
  const normalized = buildEmptyPermissions()

  const applyKnownValues = (source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return

    for (const [slug, defaults] of Object.entries(normalized)) {
      if (!Object.prototype.hasOwnProperty.call(source, slug)) continue

      const sourcePage = source[slug]
      if (!sourcePage || typeof sourcePage !== 'object' || Array.isArray(sourcePage)) {
        // Preserve malformed known entries so validatePermissionsShape can
        // reject them instead of silently granting or removing access.
        normalized[slug] = sourcePage
        continue
      }

      for (const key of Object.keys(defaults)) {
        if (Object.prototype.hasOwnProperty.call(sourcePage, key)) {
          normalized[slug][key] = sourcePage[key]
        }
      }
    }
  }

  applyKnownValues(fallbackPermissions)

  if (permissions == null) return normalized
  if (typeof permissions !== 'object' || Array.isArray(permissions)) return permissions

  applyKnownValues(permissions)
  return normalized
}

/**
 * Build a full-access permissions object from PERMISSIONS_SCHEMA.
 * Every action is set to true. Used for admin system role.
 */
export function buildFullPermissions() {
  const permissions = {}
  for (const [slug, actions] of Object.entries(PERMISSIONS_SCHEMA)) {
    permissions[slug] = { canView: true }
    for (const action of actions) {
      if (action !== ACTIONS.VIEW) {
        permissions[slug][`can${action.charAt(0).toUpperCase()}${action.slice(1)}`] = true
      }
    }
  }
  return permissions
}

/**
 * Convert an action string to its permissions key.
 * e.g. 'create' → 'canCreate', 'view' → 'canView'
 */
export function actionToKey(action) {
  if (action === ACTIONS.VIEW) return 'canView'
  return `can${action.charAt(0).toUpperCase()}${action.slice(1)}`
}

/**
 * Check if a permissions object grants a specific page+action.
 * Pure synchronous check — no DB access.
 */
export function checkPermission(permissions, pageSlug, action) {
  if (!permissions || !pageSlug || !action) return false
  const page = permissions[pageSlug]
  if (!page) return false
  const key = actionToKey(action)
  return page[key] === true
}

/**
 * Validate that a permissions object conforms to PERMISSIONS_SCHEMA shape.
 * Returns { valid: boolean, errors: string[] }
 */
export function validatePermissionsShape(permissions) {
  const errors = []
  if (!permissions || typeof permissions !== 'object') {
    return { valid: false, errors: ['Permissions must be an object'] }
  }

  for (const [slug, actions] of Object.entries(PERMISSIONS_SCHEMA)) {
    if (!permissions[slug]) {
      errors.push(`Missing page slug: ${slug}`)
      continue
    }
    if (typeof permissions[slug].canView !== 'boolean') {
      errors.push(`${slug}.canView must be a boolean`)
    }
    for (const action of actions) {
      const key = actionToKey(action)
      if (typeof permissions[slug][key] !== 'boolean') {
        errors.push(`${slug}.${key} must be a boolean`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Get page slugs organized by category for the Role Builder UI.
 * Returns Map<category, Array<{ slug, label, actions }>>
 */
export function getPermissionsByCategory() {
  const categoryMap = new Map()

  // Use defined category order
  const categoryOrder = [
    CATEGORIES.MAIN,
    CATEGORIES.ATTENDANCE_LEAVES,
    CATEGORIES.PAYROLL,
    CATEGORIES.PROJECTS_TASKS,
    CATEGORIES.PERFORMANCE,
    CATEGORIES.PEOPLE_RECRUITMENT,
    CATEGORIES.COMMUNICATION,
    CATEGORIES.RESOURCES,
    CATEGORIES.COMPANY,
    CATEGORIES.ADMINISTRATION,
  ]

  for (const cat of categoryOrder) {
    categoryMap.set(cat, [])
  }

  for (const [slug, meta] of Object.entries(PAGE_SLUG_META)) {
    const actions = PERMISSIONS_SCHEMA[slug] || []
    const category = meta.category
    if (!categoryMap.has(category)) {
      categoryMap.set(category, [])
    }
    categoryMap.get(category).push({
      slug,
      label: meta.label,
      actions,
    })
  }

  return categoryMap
}
