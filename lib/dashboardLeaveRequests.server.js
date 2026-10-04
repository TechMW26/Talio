import { NextResponse } from 'next/server'
import { dashboardAuth } from './dashboardData.server'
import { resolveTeamViewScope } from './teamViews.server'
import { projectId as id, projectFilter as filter, projectRecords } from './projects.server'
import { getTenantCompanyFeaturePayload } from './companyFeatures.server'
import { readNewestDashboardLeaves } from './dashboardLeaveQuery.server'

const LIMIT = 5
const pick = (record, fields) => record ? Object.fromEntries(fields.filter(field => record[field] !== undefined).map(field => [field, record[field]])) : null

// This small read deliberately does not depend on the rest of the dashboard,
// organizational statistics, or full employee/profile hydration.
export async function dashboardLeaveRequests(request) {
  try {
    const { database, user, tenant } = await dashboardAuth(request)
    if (!user || !database || !tenant?.companySlug) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    const organization = ['admin', 'hr'].includes(user.role)
    const management = organization || ['department_head', 'manager'].includes(user.role) || user.isDepartmentHead || user.isDepartmentManager || user.teamLeaderOf?.length
    if (!management || (!organization && !id(user.employeeId))) return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })

    const features = await getTenantCompanyFeaturePayload({ companySlug: tenant.companySlug, databaseName: database.databaseName })
    if (features?.features?.leaveManagement === false) return NextResponse.json({ success: true, data: [], view: 'pending' })

    let employeeIds = []
    if (!organization) {
      const scope = await resolveTeamViewScope(database, user, { organization: false })
      employeeIds = [...new Set(scope.members.map(id).filter(value => value && value !== id(user.employeeId)))]
    }
    const readNewest = filters => readNewestDashboardLeaves(database, filters, organization ? null : employeeIds, LIMIT)
    let rows = await readNewest([filter('status', 'pending')])
    let view = 'pending'
    if (rows.length === 0) {
      rows = await readNewest([])
      view = 'recent'
    }
    const visible = rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt) || id(a).localeCompare(id(b))).slice(0, LIMIT)
    const [employees, leaveTypes] = await Promise.all([
      projectRecords(database, 'employees', visible.map(row => row.employee)),
      projectRecords(database, 'leavetypes', visible.map(row => row.leaveType)),
    ])
    const people = new Map(employees.map(row => [id(row), pick(row, ['_id', 'firstName', 'lastName'])]))
    const types = new Map(leaveTypes.map(row => [id(row), pick(row, ['_id', 'name'])]))
    const data = visible.map(row => ({
      ...pick(row, ['_id', 'status', 'numberOfDays', 'startDate', 'endDate', 'createdAt']),
      employee: people.get(id(row.employee)) || null,
      leaveType: types.get(id(row.leaveType)) || null,
    }))
    return NextResponse.json({ success: true, data, view }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const status = [401, 403].includes(error.status) ? error.status : 500
    return NextResponse.json({ success: false, message: status === 500 ? 'Failed to fetch leave requests' : error.message }, { status })
  }
}
