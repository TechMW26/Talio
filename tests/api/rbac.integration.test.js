jest.mock('next/server', () => {
    class MockNextResponse extends Response {
        constructor(body, init = {}) {
            super(body, init)
            this.cookies = {
                set: jest.fn(),
            }
        }

        static json(data, init = {}) {
            const headers = new Headers(init.headers || {})
            if (!headers.has('content-type')) {
                headers.set('content-type', 'application/json')
            }
            return new MockNextResponse(JSON.stringify(data), {
                ...init,
                headers,
                status: init.status || 200,
            })
        }
    }

    return { NextResponse: MockNextResponse }
})

jest.mock('jose', () => ({
    jwtVerify: jest.fn(),
}))

jest.mock('@/lib/tenantModels', () => ({
    getTenantModel: jest.fn(),
}))

jest.mock('@/lib/cacheWarming', () => ({
    warmDashboardCaches: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/auth', () => ({
    getAuthAndModels: jest.fn(),
    hasRole: jest.fn((user, roles) => roles.includes(user?.role)),
}))

jest.mock('@/lib/rbacAudit', () => ({
    logRBACEvent: jest.fn().mockResolvedValue(undefined),
    extractRequestMeta: jest.fn(() => ({ ipAddress: '127.0.0.1', userAgent: 'jest' })),
}))

jest.mock('@/lib/rbacSessionRefresh', () => ({
    refreshAffectedUsers: jest.fn().mockResolvedValue({ affectedUserIds: ['user-2'], queuedCount: 0 }),
}))

const { jwtVerify } = require('jose')
const { getTenantModel } = require('@/lib/tenantModels')
const { warmDashboardCaches } = require('@/lib/cacheWarming')
const { getAuthAndModels } = require('@/lib/auth')
const { logRBACEvent } = require('@/lib/rbacAudit')
const { refreshAffectedUsers } = require('@/lib/rbacSessionRefresh')
const { PUT: assignRole } = require('@/app/api/rbac/roles/[id]/assign/route')
const { PUT: updateRole } = require('@/app/api/rbac/roles/[id]/route')
const { GET: validateAuth } = require('@/app/api/auth/validate/route')
const { POST: createTeam } = require('@/app/api/teams/route')
const {
    buildEmptyPermissions,
    normalizePermissionsShape,
    validatePermissionsShape,
} = require('@/lib/permissions.shared')
const { filterMenuByPermissions } = require('@/utils/permissionFilters')
const { getMenuItemsForRole } = require('@/utils/roleBasedMenus')
const { getMenuTemplateRole } = require('@/utils/rbacMenu')

function buildSeniorMisPermissions() {
    const permissions = buildEmptyPermissions()

    permissions.dashboard.canView = true
    permissions.chat.canView = true
    permissions.mail.canView = true
    permissions.meetings.canView = true
    permissions.todo.canView = true
    permissions.talioboard.canView = true

    permissions.projects.canView = true
    permissions.tasks.canView = true
    permissions.tasks_assigned.canView = true

    permissions.attendance_personal.canView = true
    permissions.attendance_team.canView = true
    permissions.attendance_checkins.canView = true

    permissions.performance.canView = true
    permissions.performance_my.canView = true

    permissions.announcements.canView = true
    permissions.announcements_create.canView = true
    permissions.announcements_create.canCreate = true

    permissions.assets.canView = true
    permissions.holidays.canView = true
    permissions.calendar.canView = true

    return permissions
}

function createLeanQuery(result) {
    return {
        select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(result),
        }),
    }
}

describe('RBAC integration coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('auth validate returns current role context and permissions from the database user', async () => {
        const permissions = buildSeniorMisPermissions()
        const dbUser = {
            isActive: true,
            email: 'adil.khan@mushroomworldgroup.com',
            forcePasswordChange: false,
            employeeId: 'emp-1',
            role: 'manager',
            roleId: 'role-senior-mis',
            permissionsCache: permissions,
            cacheUpdatedAt: new Date().toISOString(),
            isDepartmentHead: false,
            headOfDepartments: [],
        }

        jwtVerify.mockResolvedValue({
            payload: {
                userId: 'user-1',
                databaseName: 'talio_company_mushroom_world_group',
                role: 'employee',
            },
        })
        getTenantModel.mockResolvedValue({
            findById: jest.fn(() => createLeanQuery(dbUser)),
        })

        const request = {
            url: 'http://localhost:3000/api/auth/validate?skipWarmCache=1',
            headers: new Headers({ Authorization: 'Bearer test-token' }),
            cookies: {
                get: jest.fn(() => undefined),
            },
        }

        const response = await validateAuth(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.valid).toBe(true)
        expect(body.user.role).toBe('manager')
        expect(body.user.roleId).toBe('role-senior-mis')
        expect(body.user.permissions).toEqual(permissions)
        expect(body.user.permissionsCache).toEqual(permissions)
        expect(response.cookies.set).toHaveBeenCalledWith('token', 'test-token', expect.objectContaining({ path: '/' }))
        expect(warmDashboardCaches).not.toHaveBeenCalled()
    })

    test('custom-role menu uses the admin template and filters down to granted pages', () => {
        const permissions = buildSeniorMisPermissions()
        const user = {
            role: 'employee',
            roleId: 'role-senior-mis',
            permissions,
        }

        const menuTemplateRole = getMenuTemplateRole(user, { permissions })
        const visibleMenu = filterMenuByPermissions(
            getMenuItemsForRole(menuTemplateRole),
            permissions,
            user.role
        )

        const topLevelNames = visibleMenu.map((item) => item.name)
        const attendanceMenu = visibleMenu.find((item) => item.name === 'Attendance & Leaves')
        const projectMenu = visibleMenu.find((item) => item.name === 'Projects')

        expect(menuTemplateRole).toBe('admin')
        expect(topLevelNames).toEqual(expect.arrayContaining([
            'Dashboard',
            'Chat',
            'Mail',
            'Meetings',
            "To-Do's",
            'TalioBoard',
            'Projects',
            'Attendance & Leaves',
            'Performance',
            'Assets',
            'Announcements',
            'Holidays',
            'General Calendar',
        ]))
        expect(topLevelNames).not.toContain('Employees')
        expect(topLevelNames).not.toContain('Payroll')
        expect(topLevelNames).not.toContain('Productivity')
        expect(topLevelNames).not.toContain('Role Management')
        expect(projectMenu.submenu.map((item) => item.path)).toEqual([
            '/dashboard/projects',
            '/dashboard/projects/my-tasks',
            '/dashboard/projects/assigned-tasks',
        ])
        expect(attendanceMenu.submenu.map((item) => item.path)).toEqual([
            '/dashboard/attendance',
            '/dashboard/attendance/team',
            '/dashboard/attendance/checkins',
        ])
    })

    test('protected team creation is denied when team_members.create is not granted', async () => {
        const permissions = buildEmptyPermissions()
        permissions.team_members.canView = true

        getAuthAndModels.mockResolvedValue({
            success: true,
            user: { _id: 'user-1', userId: 'user-1' },
            tenant: { databaseName: 'talio_company_mushroom_world_group' },
            models: {
                User: {
                    findById: jest.fn(() => createLeanQuery({
                        _id: 'user-1',
                        email: 'adil.khan@mushroomworldgroup.com',
                        role: 'employee',
                        roleId: 'role-senior-mis',
                        permissionsCache: permissions,
                        cacheUpdatedAt: new Date().toISOString(),
                        isDepartmentHead: false,
                        headOfDepartments: [],
                        isDepartmentManager: false,
                        departmentManagerOf: [],
                        teamLeaderOf: [],
                        teamMemberOf: [],
                        employeeId: 'emp-1',
                    })),
                },
            },
        })

        const request = new Request('http://localhost:3000/api/teams', {
            method: 'POST',
            body: JSON.stringify({
                teamName: 'Ops Test Team',
                teamCode: 'OPS-TST',
                department: 'dept-1',
            }),
            headers: { 'content-type': 'application/json' },
        })

        const response = await createTeam(request)
        const body = await response.json()

        expect(response.status).toBe(403)
        expect(body).toMatchObject({
            success: false,
            error: 'PERMISSION_DENIED',
            pageSlug: 'team_members',
            action: 'create',
        })
        expect(logRBACEvent).toHaveBeenCalledWith(
            'talio_company_mushroom_world_group',
            expect.objectContaining({
                eventType: 'permission_denied',
                metadata: expect.objectContaining({
                    pageSlug: 'team_members',
                    action: 'create',
                }),
            })
        )
    })

    test('role reassignment clears user permission cache and triggers session refresh', async () => {
        const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 })
        const roleDoc = {
            _id: 'role-senior-mis',
            name: 'senior_mis_executive',
            displayLabel: 'Senior MIS Executive',
        }
        const models = {
            Role: {
                findById: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue(roleDoc),
                })),
            },
            User: { updateMany },
            ForceRefresh: { insertMany: jest.fn() },
        }

        getAuthAndModels.mockResolvedValue({
            success: true,
            user: { _id: 'admin-1', email: 'taliohrms@gmail.com', role: 'admin' },
            tenant: { databaseName: 'talio_company_mushroom_world_group' },
            models,
        })

        const request = new Request('http://localhost:3000/api/rbac/roles/role-senior-mis/assign', {
            method: 'PUT',
            body: JSON.stringify({ userIds: ['user-2'] }),
            headers: { 'content-type': 'application/json' },
        })

        const response = await assignRole(request, { params: Promise.resolve({ id: 'role-senior-mis' }) })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(updateMany).toHaveBeenCalledWith(
            { _id: { $in: ['user-2'] }, isActive: true },
            { $set: { roleId: 'role-senior-mis', permissionsCache: null, cacheUpdatedAt: null } }
        )
        expect(refreshAffectedUsers).toHaveBeenCalledWith(expect.objectContaining({
            databaseName: 'talio_company_mushroom_world_group',
            userIds: ['user-2'],
            forceRefreshModel: models.ForceRefresh,
            message: 'Your access role was updated to Senior MIS Executive. Talio will refresh to apply the new permissions.',
        }))
        expect(body).toMatchObject({
            success: true,
            data: { modifiedCount: 1 },
        })
    })

    test('legacy roles are hydrated to the current permission schema before update', async () => {
        const legacyPermissions = {
            dashboard: { canView: true },
        }
        const roleDoc = {
            _id: 'role-legacy',
            name: 'legacy_role',
            displayLabel: 'Legacy Role',
            description: 'Created before newer permission pages existed',
            permissions: legacyPermissions,
            isSystemRole: false,
            save: jest.fn().mockResolvedValue(undefined),
            toObject: jest.fn(function toObject() {
                return {
                    _id: this._id,
                    name: this.name,
                    displayLabel: this.displayLabel,
                    description: this.description,
                    permissions: this.permissions,
                }
            }),
        }
        const models = {
            Role: {
                findById: jest.fn().mockResolvedValue(roleDoc),
            },
            User: {
                find: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue([]),
                })),
            },
            ForceRefresh: { insertMany: jest.fn() },
        }

        getAuthAndModels.mockResolvedValue({
            success: true,
            user: { _id: 'admin-1', email: 'admin@talio.in', role: 'admin' },
            tenant: { databaseName: 'talio_company_test' },
            models,
        })

        const request = new Request('http://localhost:3000/api/rbac/roles/role-legacy', {
            method: 'PUT',
            body: JSON.stringify({
                displayLabel: 'Legacy Role Updated',
                permissions: legacyPermissions,
            }),
            headers: { 'content-type': 'application/json' },
        })

        const response = await updateRole(request, {
            params: Promise.resolve({ id: 'role-legacy' }),
        })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(roleDoc.save).toHaveBeenCalledTimes(1)
        expect(roleDoc.permissions.dashboard.canView).toBe(true)
        expect(roleDoc.permissions.employees).toBeDefined()
        expect(validatePermissionsShape(roleDoc.permissions)).toEqual({ valid: true, errors: [] })
        expect(body).toMatchObject({ success: true, message: 'Role updated successfully' })
    })

    test('permission normalization fills missing entries without hiding malformed values', () => {
        const normalized = normalizePermissionsShape({
            dashboard: { canView: true },
            employees: { canView: 'yes' },
        })

        expect(normalized.dashboard.canView).toBe(true)
        expect(normalized.chat).toBeDefined()
        expect(validatePermissionsShape(normalized)).toEqual(expect.objectContaining({ valid: false }))
    })
})
