/**
 * Organizational Hierarchy Authorization
 * 
 * Hierarchy:
 *   Super Admin (admin/hr)
 *     └── Department Head        (strategic oversight, final authority)
 *           └── Department Manager   (operational management, day-to-day)
 *                 └── Team Leader       (team-level execution)
 *                       └── Employee
 * 
 * This module provides helpers for hierarchy-aware permission checks
 * across departments, leave, attendance, projects, and team management.
 */

/**
 * Check if a user has operational authority over a department.
 * Returns true for admin, hr, department head, or department manager of that department.
 * 
 * @param {Object} user - The auth user object (from getAuthAndModels)
 * @param {string} departmentId - The department to check authority for
 * @param {Object} options - { requireHead: boolean } if true, only head-level access (excludes managers)
 * @returns {boolean}
 */
export function hasDepartmentAuthority(user, departmentId, options = {}) {
    if (!user || !departmentId) return false

    const deptId = departmentId.toString()

    // Admin/HR have universal access
    if (['admin', 'hr'].includes(user.role)) return true

    // Department Head — supreme authority
    if (user.isDepartmentHead && user.headOfDepartments?.some(d => d.toString() === deptId)) {
        return true
    }

    // Department Manager — operational authority (unless head-only required)
    if (!options.requireHead) {
        if (user.isDepartmentManager && user.departmentManagerOf?.some(d => d.toString() === deptId)) {
            return true
        }
    }

    return false
}

/**
 * Check if a user has team-level authority (can manage the given team).
 * Returns true for admin, hr, department head/manager of the team's department,
 * or a team leader of that specific team.
 * 
 * @param {Object} user - auth user
 * @param {Object} team - team document (must have .department and .teamLeaders populated or as IDs)
 * @returns {boolean}
 */
export function hasTeamAuthority(user, team) {
    if (!user || !team) return false

    // Admin/HR
    if (['admin', 'hr'].includes(user.role)) return true

    const deptId = (team.department?._id || team.department)?.toString()
    if (deptId && hasDepartmentAuthority(user, deptId)) return true

    // Team leader of this specific team
    const employeeId = (user.employeeId?._id || user.employeeId)?.toString()
    if (employeeId && team.teamLeaders?.some(l => (l._id || l).toString() === employeeId)) {
        return true
    }

    return false
}

/**
 * Determine the user's hierarchy level for a given department.
 * Returns the highest applicable role.
 * 
 * @param {Object} user - auth user
 * @param {string} departmentId - department to check
 * @returns {'super_admin' | 'department_head' | 'department_manager' | 'team_leader' | 'employee'}
 */
export function getHierarchyLevel(user, departmentId) {
    if (!user) return 'employee'
    if (['admin', 'hr'].includes(user.role)) return 'super_admin'

    const deptId = departmentId?.toString()

    if (deptId && user.isDepartmentHead && user.headOfDepartments?.some(d => d.toString() === deptId)) {
        return 'department_head'
    }

    if (deptId && user.isDepartmentManager && user.departmentManagerOf?.some(d => d.toString() === deptId)) {
        return 'department_manager'
    }

    if (user.teamLeaderOf?.length > 0) {
        return 'team_leader'
    }

    return 'employee'
}

/**
 * Check if user can approve/reject leave for a given employee.
 * Department Heads AND Department Managers can approve leave for any member of their department.
 * 
 * @param {Object} user - auth user
 * @param {Object} employee - the employee requesting leave (needs .department populated)
 * @returns {boolean}
 */
export function canApproveLeave(user, employee) {
    if (!user || !employee) return false
    if (['admin', 'hr'].includes(user.role)) return true

    const empDeptId = (employee.department?._id || employee.department)?.toString()
    if (!empDeptId) return false

    return hasDepartmentAuthority(user, empDeptId)
}

/**
 * Check if user can assign tasks within a project.
 * Rules:
 *   - Department Head / Manager: can assign to any member in the department
 *   - Team Leader: can only assign to members of their team(s)
 *   - Employee: can only self-assign / update own tasks
 * 
 * @param {Object} user - auth user
 * @param {Object} project - project document (needs .department)
 * @param {string} targetEmployeeId - the employee being assigned
 * @param {Object[]} userTeams - teams the user leads (pre-fetched)
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canAssignTask(user, project, targetEmployeeId, userTeams = []) {
    if (!user || !project) return { allowed: false, reason: 'Invalid user or project' }

    // Admin/HR: unrestricted
    if (['admin', 'hr'].includes(user.role)) return { allowed: true }

    const employeeId = (user.employeeId?._id || user.employeeId)?.toString()
    const projectDeptId = (project.department?._id || project.department)?.toString()

    // Project head can assign to anyone in the project
    const projectHeadIds = [
        ...(project.projectHeads || []).map(h => (h._id || h).toString()),
        project.projectHead ? (project.projectHead._id || project.projectHead).toString() : null
    ].filter(Boolean)
    if (employeeId && projectHeadIds.includes(employeeId)) return { allowed: true }

    // Department Head / Manager: can assign to any member in the department
    if (projectDeptId && hasDepartmentAuthority(user, projectDeptId)) {
        return { allowed: true }
    }

    // Team Leader: can only assign to their own team members
    if (userTeams.length > 0) {
        const teamMemberIds = new Set()
        for (const t of userTeams) {
            (t.members || []).forEach(m => teamMemberIds.add((m._id || m).toString()))
        }
        if (teamMemberIds.has(targetEmployeeId?.toString())) {
            return { allowed: true }
        }
        return { allowed: false, reason: 'Team leaders can only assign tasks to members of their own teams' }
    }

    // Self-assignment
    if (employeeId === targetEmployeeId?.toString()) {
        return { allowed: true }
    }

    return { allowed: false, reason: 'Insufficient permissions to assign tasks' }
}

/**
 * Build a project visibility filter based on user's hierarchy level.
 * Returns a MongoDB query filter that restricts project visibility.
 * 
 * @param {Object} user - auth user
 * @param {Object} models - tenant models { Team, ProjectMember }
 * @returns {Promise<Object>} - MongoDB query filter for Project.find()
 */
export async function getProjectVisibilityFilter(user, models) {
    if (!user) return { _id: null } // no access

    // Super Admin: all projects
    if (['admin', 'hr'].includes(user.role)) return {}

    const employeeId = (user.employeeId?._id || user.employeeId)?.toString()
    const conditions = []

    // Department Head / Manager: all projects involving their department(s)
    const deptIds = [
        ...(user.headOfDepartments || []).map(String),
        ...(user.departmentManagerOf || []).map(String),
    ]
    if (deptIds.length > 0) {
        conditions.push({ department: { $in: deptIds } })
    }

    // Team Leader: projects where any of their teams are assigned
    if (user.teamLeaderOf?.length > 0) {
        conditions.push({ assignedTeams: { $in: user.teamLeaderOf } })
    }

    // Employee: projects they are a member of
    if (employeeId && models.ProjectMember) {
        const memberships = await models.ProjectMember.find({ user: employeeId })
            .select('project')
            .lean()
        const projectIds = memberships.map(m => m.project)
        if (projectIds.length > 0) {
            conditions.push({ _id: { $in: projectIds } })
        }
    }

    // Combine with $or (any of the above gives visibility)
    if (conditions.length === 0) return { _id: null }
    return conditions.length === 1 ? conditions[0] : { $or: conditions }
}

export default {
    hasDepartmentAuthority,
    hasTeamAuthority,
    getHierarchyLevel,
    canApproveLeave,
    canAssignTask,
    getProjectVisibilityFilter,
}
