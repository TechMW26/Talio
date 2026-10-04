import { NextResponse } from 'next/server'
import { teamViewAuth, TEAM_VIEW_OPTIONS, resolveTeamViewScope, scopedEmployeeRows } from './teamViews.server'
import { taskHandler } from './tasks.server'
import { projectId as id, projectRows, projectRecords, projectFilter as f, employeeSummary } from './projects.server'
import { organizationEmployee } from './organization.server'
import { getTenantCompanyFeaturePayload } from './companyFeatures.server'
import { normalizeLeaveBalances } from './leaveData'
import { policyApplies, announcementApplies } from './communicationsStore.server'

export const DASHBOARD_STORE_OPTIONS = { queryFields: {
  ...TEAM_VIEW_OPTIONS.queryFields,
  employees: [...TEAM_VIEW_OPTIONS.queryFields.employees, 'createdAt', 'updatedAt', 'gender'],
  attendances: ['employee', 'date', 'status'], attendancecorrections: ['employee', 'status'],
  expenses: ['employee', 'status', 'createdAt'], helpdesks: ['createdBy', 'assignedTo', 'status', 'createdAt'],
  notifications: ['user', 'read'], announcements: ['status', 'isActive', 'createdAt'],
  holidays: ['date'], assets: ['assignedTo'], policies: ['isActive', 'createdAt'],
  leavebalances: ['employee', 'year'], payrolls: ['employee', 'month', 'year'], performances: ['employee', 'createdAt', 'isActive', 'overallRating', 'status'],
  jobpostings: ['status'], dailygoals: ['employee', 'user', 'date'],
} }
export const dashboardAuth = request => teamViewAuth(request, DASHBOARD_STORE_OPTIONS)
const newest = (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)
const selected = (row, fields) => row ? Object.fromEntries(['_id', ...fields].filter(field => row[field] !== undefined).map(field => [field, row[field]])) : null
export async function dashboardEmployee(database, employeeId) {
  const row = employeeId ? await database.get('employees', id(employeeId)) : null
  if (!row) return null
  const [designation, department, departments, reportingManager] = await Promise.all([
    row.designation ? database.get('designations', id(row.designation)) : null,
    row.department ? database.get('departments', id(row.department)) : null,
    projectRecords(database, 'departments', row.departments || []),
    row.reportingManager ? database.get('employees', id(row.reportingManager)) : null,
  ])
  return { ...row, designation, department, departments, reportingManager: employeeSummary(reportingManager) }
}
export const sidebarCounts = taskHandler(async request => {
  const auth = await dashboardAuth(request), { database, user } = auth, employeeId = id(user.employeeId), counts = { projects: 0, tasks: 0, leaves: 0, attendance: 0, expenses: 0, helpdesk: 0, notifications: 0 }
  if (!employeeId) return NextResponse.json({ success: true, data: counts })
  const features = (await getTenantCompanyFeaturePayload({ companySlug: auth.tenant.companySlug, databaseName: database.databaseName }))?.features || {}
  ;[counts.projects, counts.tasks, counts.notifications] = await Promise.all([
    features.projects === false ? 0 : database.count('projectmembers', [f('user', employeeId), f('invitationStatus', 'invited')]),
    features.projects === false ? 0 : database.count('taskassignees', [f('user', employeeId), f('assignmentStatus', 'pending')]),
    database.count('notifications', [f('user', id(user._id || user.userId)), f('read', false)]),
  ])
  const scope = await resolveTeamViewScope(database, user), employeeIds = scope.members.filter(row => id(row) !== employeeId).map(id)
  const pending = async (collection, feature) => features[feature] === false ? 0 : scope.organization ? database.count(collection, [f('status', 'pending'), f('employee', employeeId, '!=')]) : (await scopedEmployeeRows(database, collection, employeeIds, [f('status', 'pending')])).length
  ;[counts.leaves, counts.attendance, counts.expenses, counts.helpdesk] = await Promise.all([pending('leaves', 'leaveManagement'), pending('attendancecorrections', 'gpsAttendance'), pending('expenses', 'expenses'), scope.organization && features.helpdesk !== false ? database.count('helpdesks', [f('status', ['open', 'in-progress'], 'in')]) : 0])
  return NextResponse.json({ success: true, data: counts })
})
export const unifiedDashboard = taskHandler(async request => {
  const auth = await dashboardAuth(request), { database, user } = auth, params = new URL(request.url).searchParams, requested = (params.get('widgets') || 'all').split(','), enabled = name => requested.includes('all') || requested.includes(name)
  const [featurePayload, employee] = await Promise.all([getTenantCompanyFeaturePayload({ companySlug: auth.tenant.companySlug, databaseName: database.databaseName }), dashboardEmployee(database, user.employeeId)])
  const features = featurePayload?.features || {}, employeeId = id(employee), allowed = (feature, widget) => features[feature] !== false && enabled(widget)
  const data = { success: true, timestamp: new Date().toISOString(), companyFeatures: features, user: { _id: user._id || user.userId, role: user.role, email: user.email }, ...(employee ? { employee: selected(employee, ['firstName', 'lastName', 'employeeCode', 'designation', 'department', 'profilePicture', 'status', 'email', 'phone', 'dateOfJoining', 'employmentType', 'reportingManager', 'company']) } : {}), holidays: [], announcements: [], myAssets: [], myExpenses: [], myHelpdesk: [], policies: [], todayAttendance: null, leaveBalance: [], companySettings: null }
  const today = new Date(); today.setHours(0, 0, 0, 0); const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const jobs = []
  const collect = (key, fn) => jobs.push(Promise.resolve().then(fn).then(value => { data[key] = value }))
  if (features.gpsAttendance !== false) collect('companySettings', async () => {
    const row = employee?.company ? await database.get('companies', id(employee.company)) : (await database.list('companysettings', { limit: 1 })).records[0]
    return row ? { ...selected(row, ['name', 'timezone', 'workingHours', 'geofence', 'breakTimings']), checkInTime: row.checkInTime || row.workingHours?.checkInTime, checkOutTime: row.checkOutTime || row.workingHours?.checkOutTime, absentThresholdMinutes: row.absentThresholdMinutes || row.workingHours?.absentThresholdMinutes } : null
  })
  if (allowed('holidays', 'holidays')) collect('holidays', async () => (await database.list('holidays', { filters: [f('date', new Date(), '>=')], orderBy: [{ field: 'date', direction: 'asc' }], limit: 5 })).records)
  if (allowed('announcements', 'announcements')) collect('announcements', async () => {
    const rows = [...await projectRows(database, 'announcements', [f('status', 'published')]), ...await projectRows(database, 'announcements', [f('isActive', true)])], now = new Date()
    const visible = [...new Map(rows.map(row => [id(row), row])).values()].filter(row => (row.status === 'published' || (!row.status && row.isActive)) && ((!row.expiryDate && !row.expiresAt) || new Date(row.expiryDate || row.expiresAt) >= now) && (announcementApplies(row, employee) || ['admin', 'hr'].includes(user.role))).sort(newest).slice(0, 5)
    return Promise.all(visible.map(async row => ({ ...row, createdBy: employeeSummary(await database.get('employees', id(row.createdBy))), departments: await projectRecords(database, 'departments', row.departments || []) })))
  })
  if (employeeId && allowed('assets', 'assets')) collect('myAssets', async () => (await projectRows(database, 'assets', [f('assignedTo', employeeId)])).map(row => selected(row, ['name', 'assetCode', 'category', 'uin', 'serialNumber', 'manufacturer', 'model', 'status'])))
  if (employeeId && allowed('expenses', 'expenses')) collect('myExpenses', async () => (await database.list('expenses', { filters: [f('employee', employeeId)], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 5 })).records.map(row => selected(row, ['title', 'amount', 'status', 'category', 'createdAt'])))
  if (employeeId && allowed('helpdesk', 'helpdesk')) collect('myHelpdesk', async () => {
    const rows = [...await projectRows(database, 'helpdesks', [f('createdBy', employeeId)]), ...await projectRows(database, 'helpdesks', [f('assignedTo', employeeId)])]
    return [...new Map(rows.map(row => [id(row), row])).values()].sort(newest).slice(0, 5).map(row => selected(row, ['title', 'status', 'priority', 'category', 'createdAt']))
  })
  if (allowed('policies', 'policies')) collect('policies', async () => (await projectRows(database, 'policies', [f('isActive', true)], { orderBy: [{ field: 'createdAt', direction: 'desc' }] })).filter(row => ['admin', 'hr'].includes(user.role) || policyApplies(row, employee)).slice(0, 5).map(row => selected(row, ['title', 'category', 'effectiveDate'])))
  if (employeeId && allowed('gpsAttendance', 'attendance')) collect('todayAttendance', async () => (await database.list('attendances', { filters: [f('employee', employeeId), f('date', today, '>='), f('date', tomorrow, '<')], limit: 1 })).records[0] || null)
  if (employeeId && allowed('leaveManagement', 'leaveBalance')) collect('leaveBalance', async () => normalizeLeaveBalances(await Promise.all((await projectRows(database, 'leavebalances', [f('employee', employeeId)])).map(async row => ({ ...row, leaveType: row.leaveType ? await database.get('leavetypes', id(row.leaveType)) : null })))))
  const management = ['admin', 'hr', 'department_head', 'manager'].includes(user.role) || user.isDepartmentHead || user.isDepartmentManager || user.teamLeaderOf?.length
  if (management && (allowed('leaveManagement', 'leaveRequests') || allowed('employees', 'departments') || allowed('gpsAttendance', 'attendanceSummary'))) {
    // Organization-wide pending lists and department cards do not need every
    // employee or department-manager relationship loaded first.
    const scope = ['admin', 'hr'].includes(user.role) && !allowed('gpsAttendance', 'attendanceSummary')
      ? { organization: true, members: [], authorityDepartments: [] }
      : await resolveTeamViewScope(database, user)
    data.pendingLeaveRequests = []
    if (allowed('leaveManagement', 'leaveRequests')) collect('pendingLeaveRequests', async () => {
      const rows = scope.organization ? await projectRows(database, 'leaves', [f('status', 'pending')]) : await scopedEmployeeRows(database, 'leaves', scope.members.filter(row => id(row) !== employeeId).map(id), [f('status', 'pending')])
      return Promise.all(rows.sort(newest).slice(0, 10).map(async row => ({ ...row, employee: await organizationEmployee(database, row.employee), leaveType: row.leaveType ? await database.get('leavetypes', id(row.leaveType)) : null })))
    })
    if (['admin', 'hr', 'department_head'].includes(user.role)) {
      data.departments = []; data.attendanceSummary = { totalEmployees: 0, presentToday: 0, absentToday: 0, lateToday: 0 }
      if (allowed('employees', 'departments')) collect('departments', async () => (scope.organization ? await projectRows(database, 'departments', [f('isActive', true)]) : scope.authorityDepartments).map(row => selected(row, ['name', 'employeeCount'])))
      if (allowed('gpsAttendance', 'attendanceSummary')) collect('attendanceSummary', async () => {
        const members = scope.members.filter(row => ['active', 'probation', 'on_leave'].includes(row.status)), rows = await scopedEmployeeRows(database, 'attendances', members.map(id), [f('date', today, '>='), f('date', tomorrow, '<')]), present = new Set(rows.filter(row => ['present', 'late', 'half-day', 'in-progress'].includes(row.status)).map(row => id(row.employee)))
        return { totalEmployees: members.length, presentToday: present.size, absentToday: Math.max(0, members.length - present.size), lateToday: new Set(rows.filter(row => row.status === 'late').map(row => id(row.employee))).size }
      })
    }
  }
  await Promise.all(jobs)
  return NextResponse.json(data)
})
