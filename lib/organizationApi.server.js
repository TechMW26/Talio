import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from './auth'
import { requirePermission } from './permissions'
import { buildCacheKey, buildCachePattern, getCache, setCache, clearCachePattern } from './cache'
import { getOrganizationDatabase, assertOrganizationId, populateDepartment, populateTeam, saveDepartment, saveTeam, organizationEmployee } from './organization.server'
import { collectFirestorePages } from './platform/firestoreQueries.server'

export function organizationApi({ permission, action } = {}, handler) {
  return async (request, context = {}) => {
    try {
      const auth = permission ? await requirePermission(permission, action)(request, []) : await getAuthAndDatabase(request)
      if (auth.denied) return auth.denied
      if (!auth.user) return NextResponse.json({ success: false, message: auth.message || 'Unauthorized' }, { status: auth.status || 401 })
      const database = await getOrganizationDatabase(auth), params = await context.params || {}
      for (const value of Object.values(params)) assertOrganizationId(value)
      let input = {}
      if (request.method !== 'GET') {
        try { input = await request.json() } catch { if (request.method !== 'DELETE') return NextResponse.json({ success: false, message: 'Invalid JSON body' }, { status: 400 }) }
        if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ success: false, message: 'Invalid request body' }, { status: 400 })
      }
      const response = await handler({ request, auth, database, params, input })
      if (request.method !== 'GET') await clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace: 'departments:list' })).catch(() => {})
      return response
    } catch (error) {
      console.error('[Organization]', error)
      const status = error.status || (error.code === 'ALREADY_EXISTS' ? 409 : 500)
      return NextResponse.json({ success: false, message: status === 500 ? 'Organization request could not be completed' : error.message }, { status })
    }
  }
}
const notFound = label => NextResponse.json({ success: false, message: `${label} not found` }, { status: 404 })
export const listDepartments = organizationApi({}, async ({ auth, database }) => {
  const key = buildCacheKey({ tenantId: auth.tenant.databaseName, role: 'any', userId: 'all', namespace: 'departments:list' })
  const cached = await getCache(key)
  if (cached) return NextResponse.json(cached)
  const records = await collectFirestorePages(database, 'departments', { filters: [{ field: 'isActive', operator: '==', value: true }], orderBy: [{ field: 'name' }] })
  const response = { success: true, data: await Promise.all(records.map(record => populateDepartment(database, record))) }
  await setCache(key, response, 300)
  return NextResponse.json(response)
})
export const getDepartment = organizationApi({}, async ({ database, params }) => {
  const record = await database.get('departments', params.id)
  return record ? NextResponse.json({ success: true, data: await populateDepartment(database, record, true) }) : notFound('Department')
})
export const changeDepartment = mode => organizationApi({ permission: 'departments', action: mode === 'delete' ? 'delete' : mode === 'create' ? 'create' : 'edit' }, async ({ database, params, input }) => {
  const record = await saveDepartment(database, input, params.id, mode === 'create' ? 'save' : mode)
  return NextResponse.json({ success: true, ...(mode === 'delete' ? {} : { data: await populateDepartment(database, record, true) }), message: mode === 'delete' ? 'Department deleted successfully' : mode === 'create' ? 'Department created successfully' : 'Department updated successfully' }, { status: mode === 'create' ? 201 : 200 })
})
export const listTeams = organizationApi({}, async ({ database, request }) => {
  const params = new URL(request.url).searchParams, filters = []
  const department = params.get('department')
  if (department) { assertOrganizationId(department); filters.push({ field: 'department', operator: '==', value: department }) }
  if (params.get('includeInactive') !== 'true') filters.push({ field: 'isActive', operator: '==', value: true })
  const records = await collectFirestorePages(database, 'teams', { filters, orderBy: [{ field: 'teamName' }] })
  return NextResponse.json({ success: true, data: await Promise.all(records.map(record => populateTeam(database, record))) })
})
export const getTeam = (field = null) => organizationApi({}, async ({ database, params }) => {
  const record = await database.get('teams', params.teamId)
  if (!record) return notFound('Team')
  const team = await populateTeam(database, record, Boolean(field))
  if (field === 'leaders') return NextResponse.json({ success: true, data: team.teamLeaders.map(person => ({ ...person, isCrossDepartment: Boolean(person.department && team.department && person.department._id !== team.department._id), teamDepartment: team.department })), team: { _id: team._id, teamName: team.teamName, department: team.department } })
  return NextResponse.json({ success: true, data: field === 'members' ? team.members : team })
})
export const changeTeam = mode => organizationApi({ permission: 'team_members', action: mode === 'create' ? 'create' : mode === 'delete' ? 'delete' : mode === 'save' ? 'edit' : 'assign' }, async ({ database, auth, params, input }) => {
  const record = await saveTeam(database, auth.user, input, params.teamId, mode === 'create' ? 'save' : mode)
  const team = mode !== 'delete' ? await populateTeam(database, record, mode.startsWith('leaders')) : null
  return NextResponse.json({ success: true, ...(team ? { data: mode.startsWith('leaders') ? team.teamLeaders : team } : {}), message: mode === 'delete' ? 'Team deleted successfully' : mode === 'create' ? 'Team created successfully' : 'Team updated successfully' }, { status: mode === 'create' ? 201 : 200 })
})
export const teamsByEmployee = organizationApi({}, async ({ database, params }) => {
  const employee = await organizationEmployee(database, params.employeeId, true)
  if (!employee) return notFound('Employee')
  const active = { field: 'isActive', operator: '==', value: true }
  const [leaders, members, reportsManager, reportsLead] = await Promise.all([
    collectFirestorePages(database, 'teams', { filters: [active, { field: 'teamLeaders', operator: 'array-contains', value: params.employeeId }] }),
    collectFirestorePages(database, 'teams', { filters: [active, { field: 'members', operator: 'array-contains', value: params.employeeId }] }),
    ...['assignedManager', 'assignedTeamLead'].map(field => collectFirestorePages(database, 'employees', { filters: [{ field: 'status', operator: '==', value: 'active' }, { field, operator: '==', value: params.employeeId }] })),
  ])
  const leading = await Promise.all(leaders.map(async record => { const team = await populateTeam(database, record); return { ...team, isCrossDepartment: Boolean(employee.department && team.department?._id !== employee.department._id), homeDepartment: employee.department } }))
  const memberOf = await Promise.all(members.map(record => populateTeam(database, record)))
  const reportIds = [...new Set([...reportsManager, ...reportsLead].map(record => record._id))]
  const assignedReports = await Promise.all(reportIds.map(id => organizationEmployee(database, id, true)))
  return NextResponse.json({ success: true, data: { employee: { _id: employee._id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode, department: employee.department }, leading, memberOf, assignedReports, summary: { teamsLeading: leading.length, teamsMemberOf: memberOf.length, departmentsLeadingAcross: new Set(leading.map(record => record.department?._id).filter(Boolean)).size, directReports: assignedReports.length } } })
})
