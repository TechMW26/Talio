/**
 * lib/systemRoles.js
 *
 * Built-in system role definitions derived directly from the Phase 1 audit.
 * These roles cannot be deleted and map to the 7 existing User.role enum values.
 *
 * Access levels are based on actual codebase behavior, not assumptions.
 * lib/hierarchyAuth.js still handles resource-level contextual authorization
 * (e.g. "can this dept head see THIS department's data") — this file only
 * handles page-level + action-level permissions.
 */

import {
    PAGE_SLUGS as S,
    ACTIONS as A,
    buildEmptyPermissions,
    buildFullPermissions,
    actionToKey,
} from './permissions.js'

// ---------------------------------------------------------------------------
// Helper: start with an empty permissions object and selectively enable
// ---------------------------------------------------------------------------
function grant(permissions, slug, actions) {
    if (!permissions[slug]) return
    permissions[slug].canView = true
    for (const action of actions) {
        const key = actionToKey(action)
        if (permissions[slug][key] !== undefined) {
            permissions[slug][key] = true
        }
    }
}

function grantView(permissions, slug) {
    if (!permissions[slug]) return
    permissions[slug].canView = true
}

function grantAll(permissions, slug) {
    if (!permissions[slug]) return
    permissions[slug].canView = true
    for (const key of Object.keys(permissions[slug])) {
        permissions[slug][key] = true
    }
}

// ---------------------------------------------------------------------------
// ADMIN — full access to every page and every action
// ---------------------------------------------------------------------------
function buildAdminPermissions() {
    return buildFullPermissions()
}

// ---------------------------------------------------------------------------
// HR — everything except RBAC roles management and core admin settings
// ---------------------------------------------------------------------------
function buildHRPermissions() {
    const p = buildFullPermissions()
    // HR cannot manage RBAC roles (admin only)
    p[S.RBAC_ROLES] = { canView: false, canCreate: false, canEdit: false, canDelete: false, canManage: false }
    return p
}

// ---------------------------------------------------------------------------
// MANAGER — team/project management, own attendance/leave, approvals
// ---------------------------------------------------------------------------
function buildManagerPermissions() {
    const p = buildEmptyPermissions()

    // Main
    grantView(p, S.DASHBOARD)
    grant(p, S.CHAT, [A.VIEW, A.CREATE])
    grantView(p, S.MAIL)
    grant(p, S.MEETINGS, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])
    grant(p, S.TODO, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])
    grant(p, S.TALIOBOARD, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])

    // Attendance & Leave (personal + approvals)
    grantView(p, S.ATTENDANCE_PERSONAL)
    grant(p, S.ATTENDANCE_CORRECTIONS, [A.VIEW, A.CREATE, A.APPROVE, A.REJECT])
    grantView(p, S.LEAVE_PERSONAL)
    grant(p, S.LEAVE_APPLY, [A.VIEW, A.CREATE])
    grant(p, S.LEAVE_REQUESTS, [A.VIEW, A.DELETE])
    grant(p, S.LEAVE_APPROVALS, [A.VIEW, A.APPROVE, A.REJECT])
    grantView(p, S.LEAVE_BALANCE)
    grant(p, S.LEAVE_WORK_FROM_HOME, [A.VIEW, A.CREATE])
    grant(p, S.LEAVE_EARLY_LEAVE, [A.VIEW, A.CREATE])

    // Projects & Tasks
    grant(p, S.PROJECTS, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])
    grant(p, S.PROJECTS_CREATE, [A.VIEW, A.CREATE])
    grant(p, S.PROJECTS_EDIT, [A.VIEW, A.EDIT])
    grant(p, S.PROJECTS_APPROVALS, [A.VIEW, A.APPROVE, A.REJECT])
    grant(p, S.TASKS, [A.VIEW, A.CREATE, A.EDIT, A.DELETE, A.ASSIGN])
    grantView(p, S.TASKS_ASSIGNED)

    // Performance
    grantView(p, S.PERFORMANCE_MY)
    grant(p, S.PERFORMANCE_GOALS, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])
    grant(p, S.PERFORMANCE_GOALS_CREATE, [A.VIEW, A.CREATE])

    // Recruitment (candidates + interviews, per audit)
    grant(p, S.RECRUITMENT_CANDIDATES, [A.VIEW, A.CREATE, A.EDIT])
    grant(p, S.RECRUITMENT_INTERVIEWS, [A.VIEW, A.CREATE, A.EDIT])

    // Communication
    grantView(p, S.ANNOUNCEMENTS)
    grantView(p, S.CALENDAR)

    // Finance
    grantView(p, S.PAYROLL_PAYSLIPS)
    grant(p, S.EXPENSES, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])
    grant(p, S.EXPENSES_APPROVALS, [A.VIEW, A.APPROVE, A.REJECT])

    // Resources
    grant(p, S.DOCUMENTS, [A.VIEW, A.CREATE, A.DELETE])
    grant(p, S.ASSETS, [A.VIEW])
    grant(p, S.HELPDESK, [A.VIEW, A.CREATE])
    grantView(p, S.POLICIES)
    grantView(p, S.LEARNING)
    grant(p, S.SANDBOX, [A.VIEW, A.CREATE])
    grant(p, S.WHITEBOARD, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])

    // Team
    grantView(p, S.TEAM_MEMBERS)

    return p
}

// ---------------------------------------------------------------------------
// EMPLOYEE — personal functions only
// ---------------------------------------------------------------------------
function buildEmployeePermissions() {
    const p = buildEmptyPermissions()

    // Main
    grantView(p, S.DASHBOARD)
    grant(p, S.CHAT, [A.VIEW, A.CREATE])
    grantView(p, S.MAIL)
    grant(p, S.MEETINGS, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])
    grant(p, S.TODO, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])
    grant(p, S.TALIOBOARD, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])

    // Attendance & Leave (personal)
    grantView(p, S.ATTENDANCE_PERSONAL)
    grant(p, S.ATTENDANCE_CORRECTIONS, [A.VIEW, A.CREATE])
    grantView(p, S.LEAVE_PERSONAL)
    grant(p, S.LEAVE_APPLY, [A.VIEW, A.CREATE])
    grantView(p, S.LEAVE_REQUESTS)
    grantView(p, S.LEAVE_BALANCE)
    grant(p, S.LEAVE_WORK_FROM_HOME, [A.VIEW, A.CREATE])
    grant(p, S.LEAVE_EARLY_LEAVE, [A.VIEW, A.CREATE])

    // Projects & Tasks (member level)
    grant(p, S.PROJECTS, [A.VIEW, A.CREATE])
    grant(p, S.PROJECTS_CREATE, [A.VIEW, A.CREATE])
    grant(p, S.PROJECTS_APPROVALS, [A.VIEW])
    grant(p, S.TASKS, [A.VIEW, A.CREATE, A.EDIT])
    grantView(p, S.TASKS_ASSIGNED)

    // Performance (own only)
    grantView(p, S.PERFORMANCE_MY)

    // Communication
    grantView(p, S.ANNOUNCEMENTS)
    grantView(p, S.CALENDAR)

    // Finance (own payslips + expenses)
    grantView(p, S.PAYROLL_PAYSLIPS)
    grant(p, S.EXPENSES, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])
    grant(p, S.EXPENSES_APPROVALS, [A.VIEW])

    // Resources
    grant(p, S.DOCUMENTS, [A.VIEW, A.CREATE, A.DELETE])
    grantView(p, S.ASSETS)
    grant(p, S.HELPDESK, [A.VIEW, A.CREATE])
    grantView(p, S.POLICIES)
    grantView(p, S.LEARNING)
    grant(p, S.SANDBOX, [A.VIEW, A.CREATE])
    grant(p, S.WHITEBOARD, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])

    return p
}

// ---------------------------------------------------------------------------
// DEPARTMENT_HEAD — manager permissions + productivity, live users,
// team attendance, regularisation, performance ratings/reports
// ---------------------------------------------------------------------------
function buildDepartmentHeadPermissions() {
    const p = buildManagerPermissions()

    // Additional monitoring
    grantView(p, S.PRODUCTIVITY)
    grantView(p, S.LIVE_USERS)

    // Team attendance
    grant(p, S.ATTENDANCE_TEAM, [A.VIEW, A.EXPORT])
    grant(p, S.ATTENDANCE_REGULARISATION, [A.VIEW, A.APPROVE, A.REJECT])
    grantView(p, S.ATTENDANCE_REPORT)

    // Performance (team-wide)
    grantView(p, S.PERFORMANCE)
    grant(p, S.PERFORMANCE_RATINGS, [A.VIEW, A.CREATE, A.EDIT])
    grant(p, S.PERFORMANCE_REPORTS, [A.VIEW, A.EXPORT])

    // Announcements create (audit: admin/hr/manager/dept_head)
    grant(p, S.ANNOUNCEMENTS_CREATE, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])

    // Departments (dept heads can manage dept managers)
    grant(p, S.DEPARTMENTS, [A.VIEW, A.EDIT])

    // Team management
    grantAll(p, S.TEAM_MEMBERS)

    return p
}

// ---------------------------------------------------------------------------
// DEPARTMENT_MANAGER — similar to department_head but cannot delete teams
// or manage department managers (per existing route authorization)
// ---------------------------------------------------------------------------
function buildDepartmentManagerPermissions() {
    const p = buildDepartmentHeadPermissions()
    // Dept managers cannot assign/remove department managers
    if (p[S.DEPARTMENTS]) {
        p[S.DEPARTMENTS].canEdit = false
        p[S.DEPARTMENTS].canDelete = false
    }
    // Dept managers cannot delete teams
    if (p[S.TEAM_MEMBERS]) {
        p[S.TEAM_MEMBERS].canDelete = false
    }
    return p
}

// ---------------------------------------------------------------------------
// TEAM_LEADER — employee permissions + team-scoped extras
// ---------------------------------------------------------------------------
function buildTeamLeaderPermissions() {
    const p = buildEmployeePermissions()

    // Team-scoped monitoring
    grantView(p, S.PRODUCTIVITY)
    grantView(p, S.ATTENDANCE_TEAM)
    grant(p, S.ATTENDANCE_REGULARISATION, [A.VIEW, A.APPROVE, A.REJECT])

    // Leave approvals (team)
    grant(p, S.LEAVE_APPROVALS, [A.VIEW, A.APPROVE, A.REJECT])

    // Performance (team)
    grant(p, S.PERFORMANCE_RATINGS, [A.VIEW, A.CREATE, A.EDIT])
    grant(p, S.PERFORMANCE_GOALS, [A.VIEW, A.CREATE, A.EDIT, A.DELETE])
    grant(p, S.PERFORMANCE_GOALS_CREATE, [A.VIEW, A.CREATE])
    grant(p, S.PERFORMANCE_REPORTS, [A.VIEW])

    // Tasks (assign)
    grant(p, S.TASKS, [A.VIEW, A.CREATE, A.EDIT, A.DELETE, A.ASSIGN])

    // Team management (leaders can add/remove members but not create/edit/delete teams)
    grant(p, S.TEAM_MEMBERS, [A.VIEW, A.ASSIGN])

    return p
}

// ---------------------------------------------------------------------------
// SYSTEM_ROLE_DEFINITIONS — complete definitions for seeding
// Keys match User.role enum values exactly
// ---------------------------------------------------------------------------
export const SYSTEM_ROLE_DEFINITIONS = {
    admin: {
        name: 'admin',
        displayLabel: 'Admin',
        description: 'Full platform access — can manage all features, settings, and users',
        buildPermissions: buildAdminPermissions,
    },
    hr: {
        name: 'hr',
        displayLabel: 'HR Admin',
        description: 'Employee management, attendance, leaves, payroll, announcements, and settings',
        buildPermissions: buildHRPermissions,
    },
    manager: {
        name: 'manager',
        displayLabel: 'Manager',
        description: 'Team-level attendance, leaves, projects, tasks, and recruitment',
        buildPermissions: buildManagerPermissions,
    },
    employee: {
        name: 'employee',
        displayLabel: 'Employee',
        description: 'Personal attendance, leave, payslips, chat, announcements, and to-dos',
        buildPermissions: buildEmployeePermissions,
    },
    department_head: {
        name: 'department_head',
        displayLabel: 'Department Head',
        description: 'Department-level strategic authority with full team oversight',
        buildPermissions: buildDepartmentHeadPermissions,
    },
    department_manager: {
        name: 'department_manager',
        displayLabel: 'Department Manager',
        description: 'Department operational management with team oversight',
        buildPermissions: buildDepartmentManagerPermissions,
    },
    team_leader: {
        name: 'team_leader',
        displayLabel: 'Team Leader',
        description: 'Team-level execution with task assignment and leave approval',
        buildPermissions: buildTeamLeaderPermissions,
    },
}

/**
 * Get the system role permissions for a given legacy role string.
 * Used during migration and as fallback for users without roleId.
 */
export function getPermissionsForLegacyRole(roleName) {
    const def = SYSTEM_ROLE_DEFINITIONS[roleName]
    if (!def) {
        // Unknown role — fall back to employee (safest default)
        return SYSTEM_ROLE_DEFINITIONS.employee.buildPermissions()
    }
    return def.buildPermissions()
}
