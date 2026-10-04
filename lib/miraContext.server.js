import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'
import { normalizeLeaveBalance } from './leaveData'
import { MIRA_CHAT_STORE_OPTIONS } from './miraChatStore.server'

export const MIRA_CONTEXT_STORE_OPTIONS = {
  ...MIRA_CHAT_STORE_OPTIONS,
  queryFields: { ...MIRA_CHAT_STORE_OPTIONS.queryFields,
    attendances: ['employee', 'date', 'status'], employees: ['status', 'assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager'],
    taskassignees: ['task', 'user', 'assignmentStatus'], tasks: ['updatedAt', 'createdBy'], projects: ['projectHead', 'projectHeads', 'createdBy', 'updatedAt'], projectmembers: ['project', 'user'],
    leaves: ['employee', 'createdAt'], leavebalances: ['employee', 'year'], announcements: ['status', 'createdAt'], policies: ['isActive'], performancegoals: ['employee', 'createdAt'], meetings: ['organizer', 'inviteeEmployeeIds', 'scheduledStart'],
  },
}
const eq = (field, value) => ({ field, operator: '==', value })
const idOf = value => String(value?._id || value || '')
const unique = records => [...new Map(records.map(record => [record._id, record])).values()]
const name = employee => employee ? [employee.firstName, employee.lastName].filter(Boolean).join(' ') : 'Unknown'
const newest = (records, field, limit) => records.sort((a, b) => new Date(b[field] || 0) - new Date(a[field] || 0)).slice(0, limit)
const visibleRecord = record => record && !record.isDeleted && !record.deletedAt
export async function miraEmployeeProfile(database, id) {
  const employee = await database.get('employees', idOf(id))
  if (!employee) return null
  const [department, designation] = await Promise.all([employee.department ? database.get('departments', idOf(employee.department)) : null, employee.designation ? database.get('designations', idOf(employee.designation)) : null])
  return { firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode, department: department ? { name: department.name } : null, designation: designation ? { name: designation.title || designation.name } : null }
}
export function miraAudienceAllows(record, employee, kind) {
  const scope = kind === 'policy' ? record.applicableTo || 'all' : record.targetAudience || 'all'
  if (scope === 'all') return true
  if (scope === 'specific') return (record.specificEmployees || []).map(idOf).includes(employee._id)
  if (scope === 'company') return (record.companies || []).map(idOf).includes(idOf(employee.company))
  if (scope === 'department') return [...(record.departments || []), record.department].filter(Boolean).map(idOf).some(id => [employee.department, ...(employee.departments || [])].map(idOf).includes(id))
  return false
}
/** Intent-limited native queries. Only explicit public fields leave this module;
 * a failed domain is flagged unavailable, never replaced by a broader scan.
 */
export async function fetchMiraContext(database, user, role, query) {
  const context = {}, employeeId = idOf(user.employeeId)
  if (!employeeId) return { requestedDataUnavailable: true }
  const employee = await database.get('employees', employeeId)
  if (!employee) return { requestedDataUnavailable: true }
  const isAdmin = ['admin', 'hr', 'super_admin'].includes(role)
  const isManager = ['manager', 'department_head', 'department_manager', 'team_leader', 'team_lead'].includes(role)
  const personal = /\b(my|mine|assigned to me|i have|i am|my own)\b|मेरी|मेरा|मेरे/i.test(query)
  const overview = /dashboard|overview|summary|डैशबोर्ड|सारांश|मेरी स्थिति|my status/i.test(query)
  const list = async (collection, filters = [], orderBy = [], limit = 50) => (await database.list(collection, { filters, orderBy, limit })).records
  const sort = field => [{ field, direction: 'desc' }]
  const jobs = [], schedule = fn => jobs.push(fn().catch(() => { context.requestedDataUnavailable = true; context.dashboardContextIncomplete = true }))
  let assignmentsPromise, ownTasksPromise
  const assignments = () => assignmentsPromise ||= collectFirestorePages(database, 'taskassignees', { filters: [eq('user', employeeId), { field: 'assignmentStatus', operator: 'in', value: ['pending', 'accepted'] }] }, 5000)
  const ownTasks = () => ownTasksPromise ||= (async () => {
    const assigned = await assignments()
    const tasks = await readFirestoreReferences(database, 'tasks', assigned.map(a => a.task))
    const created = await collectFirestorePages(database, 'tasks', { filters: [eq('createdBy', employeeId)] }, 5000)
    return unique([...tasks.values(), ...created]).filter(visibleRecord)
  })()
  const taskCards = async records => {
    const projects = await readFirestoreReferences(database, 'projects', records.map(t => t.project))
    return records.map(t => ({ id: t._id, title: t.title, status: t.status, priority: t.priority, project: projects.get(idOf(t.project))?.name, projectId: idOf(t.project), dueDate: t.dueDate, progress: t.progressPercentage }))
  }
  if (overview || /attend|check.?in|check.?out|present|absent|late|punch|working hours|उपस्थिति|हाजिरी|चेक|घंटे/i.test(query)) schedule(async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
    const dateFilters = [{ field: 'date', operator: '>=', value: today }, { field: 'date', operator: '<', value: tomorrow }]
    const own = await list('attendances', [eq('employee', employeeId), ...dateFilters], [], 2)
    if (own.length > 1) throw new Error('Duplicate attendance requires reconciliation')
    const a = own[0]
    context.myTodayAttendance = a ? { checkIn: a.checkIn, checkOut: a.checkOut, status: a.status, workingHours: a.workHours } : null
    if (a?.location?.checkIn) { const { latitude, longitude, address } = a.location.checkIn; context.lastCheckInLocation = { latitude, longitude, address, recordedAt: a.checkIn, source: 'today recorded check-in, not current device location' } }
    if (isAdmin && !personal) {
      const [rows, presentToday, totalEmployees] = await Promise.all([list('attendances', dateFilters), database.count('attendances', [...dateFilters, { field: 'status', operator: 'in', value: ['present', 'late', 'in-progress'] }]), database.count('employees', [eq('status', 'active')])])
      const refs = await readFirestoreReferences(database, 'employees', rows.map(r => r.employee))
      context.todayAttendance = rows.map(r => ({ employee: name(refs.get(idOf(r.employee))), code: refs.get(idOf(r.employee))?.employeeCode, checkIn: r.checkIn, checkOut: r.checkOut, status: r.status, workingHours: r.workHours }))
      context.overview = { presentToday, totalEmployees }
    } else context.myAttendance = (await list('attendances', [eq('employee', employeeId)], sort('date'), 14)).map(r => ({ date: r.date, checkIn: r.checkIn, checkOut: r.checkOut, status: r.status, workingHours: r.workHours }))
  })
  if (overview || /task|todo|assign|work|backlog|deadline|overdue|काम|टास्क|कार्य/i.test(query)) schedule(async () => {
    const mine = await ownTasks()
    const pending = mine.filter(t => ['todo', 'in-progress'].includes(t.status))
    context.myPendingTasks = pending.length
    context.myTaskPreview = pending.sort((a, b) => new Date(a.dueDate || 8640000000000000) - new Date(b.dueDate || 8640000000000000)).slice(0, 5).map(t => ({ title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate }))
    if (isAdmin && !personal) {
      const tasks = (await list('tasks', [], sort('updatedAt'), 30)).filter(visibleRecord)
      const assigned = tasks.length ? await collectFirestorePages(database, 'taskassignees', { filters: [{ field: 'task', operator: 'in', value: tasks.map(t => t._id) }] }, 5000) : []
      const refs = await readFirestoreReferences(database, 'employees', assigned.map(a => a.user))
      context.tasks = (await taskCards(tasks)).map(t => ({ ...t, assignees: assigned.filter(a => idOf(a.task) === t.id && a.assignmentStatus !== 'rejected').map(a => name(refs.get(idOf(a.user)))).join(', ') || 'Unassigned' }))
    } else context.myTasks = await taskCards(newest(mine, 'updatedAt', 20))
  })
  if (overview || /leave|vacation|day.?off|sick|holiday|time.?off|pto|balance|छुट्टी|अवकाश/i.test(query)) schedule(async () => {
    const scope = isAdmin && !personal ? [] : [eq('employee', employeeId)]
    const [leaves, balances, mine] = await Promise.all([list('leaves', scope, sort('createdAt'), 20), list('leavebalances', scope, [], 20), list('leavebalances', [eq('employee', employeeId), eq('year', new Date().getFullYear())], [], 12)])
    const [refs, types] = await Promise.all([readFirestoreReferences(database, 'employees', [...leaves, ...balances].map(r => r.employee)), readFirestoreReferences(database, 'leavetypes', [...leaves, ...balances, ...mine].map(r => r.leaveType))])
    context.leaves = leaves.map(l => ({ employee: name(refs.get(idOf(l.employee))), type: types.get(idOf(l.leaveType))?.name, startDate: l.startDate, endDate: l.endDate, status: l.status, reason: l.reason }))
    context.leaveBalances = balances.map(b => { const n = normalizeLeaveBalance(b); return { employee: name(refs.get(idOf(b.employee))), type: types.get(idOf(b.leaveType))?.name, total: n.totalDays, used: n.usedDays, remaining: n.remainingDays } })
    context.myLeaveBalances = mine.map(b => { const n = normalizeLeaveBalance(b); return { type: types.get(idOf(b.leaveType))?.name, used: n.usedDays, remaining: n.remainingDays } })
  })
  if (/project|milestone|progress|team|sprint/i.test(query)) schedule(async () => {
    let projects
    if (isAdmin && !personal) projects = await list('projects', [], sort('updatedAt'), 15)
    else {
      const members = await collectFirestorePages(database, 'projectmembers', { filters: [eq('user', employeeId)] }, 5000)
      const refs = await readFirestoreReferences(database, 'projects', members.filter(m => m.invitationStatus === 'accepted' && !m.removedAt).map(m => m.project))
      const owned = await Promise.all([['projectHead', '==', employeeId], ['projectHeads', 'array-contains', employeeId], ['createdBy', '==', employeeId]].map(([field, operator, value]) => list('projects', [{ field, operator, value }], sort('updatedAt'), 15)))
      projects = newest(unique([...refs.values(), ...owned.flat()]), 'updatedAt', 15)
    }
    projects = projects.filter(visibleRecord)
    const refs = await readFirestoreReferences(database, 'employees', projects.map(p => p.projectHead))
    context.projects = projects.map(p => ({ name: p.name, status: p.status, completion: p.completionPercentage, head: name(refs.get(idOf(p.projectHead))), deadline: p.deadline, startDate: p.startDate }))
  })
  if ((isAdmin || isManager) && /employee|staff|team member|headcount|people|roster/i.test(query)) schedule(async () => {
    let rows, total
    if (isAdmin) [rows, total] = await Promise.all([list('employees', [eq('status', 'active')]), database.count('employees', [eq('status', 'active')])])
    else {
      const groups = await Promise.all(['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager'].map(field => collectFirestorePages(database, 'employees', { filters: [eq(field, employeeId), eq('status', 'active')] })))
      const all = unique(groups.flat()); total = all.length; rows = all.slice(0, 50)
    }
    const [depts, designations] = await Promise.all([readFirestoreReferences(database, 'departments', rows.map(r => r.department)), readFirestoreReferences(database, 'designations', rows.map(r => r.designation))])
    context.employeeDirectory = { total, returned: rows.length, scope: isAdmin ? 'active employees in this organization' : 'active direct reports' }
    context.employees = rows.map(e => ({ name: name(e), code: e.employeeCode, department: depts.get(idOf(e.department))?.name, designation: designations.get(idOf(e.designation))?.title, email: e.email, status: e.status }))
  })
  if (/announce|policy|notice|update|news|circular/i.test(query)) schedule(async () => {
    const [announcements, policies] = await Promise.all([list('announcements', [eq('status', 'published')], sort('createdAt'), 50), list('policies', [eq('isActive', true)], [], 50)])
    const now = new Date()
    context.announcements = announcements.filter(a => (!a.publishDate || new Date(a.publishDate) <= now) && (!a.expiryDate || new Date(a.expiryDate) > now) && miraAudienceAllows(a, employee, 'announcement')).slice(0, 10).map(a => ({ title: a.title, content: a.content?.slice(0, 200), priority: a.priority, createdAt: a.createdAt, category: a.category }))
    context.policies = policies.filter(p => (!p.effectiveDate || new Date(p.effectiveDate) <= now) && (!p.expiryDate || new Date(p.expiryDate) > now) && miraAudienceAllows(p, employee, 'policy')).slice(0, 10).map(p => ({ title: p.title, category: p.category, description: p.description?.slice(0, 200) }))
  })
  if (/performance|review|rating|goal|kpi|appraisal|feedback/i.test(query)) schedule(async () => {
    const goals = await list('performancegoals', isAdmin && !personal ? [] : [eq('employee', employeeId)], sort('createdAt'), 15)
    const refs = await readFirestoreReferences(database, 'employees', goals.map(g => g.employee))
    context.goals = goals.map(g => ({ title: g.title, employee: name(refs.get(idOf(g.employee))), status: g.status, progress: g.progress, dueDate: g.dueDate }))
  })
  if (overview || /meeting|calendar|schedule|call|standup|sync|मीटिंग|बैठक/i.test(query)) schedule(async () => {
    const personalPages = await Promise.all([['organizer', '=='], ['inviteeEmployeeIds', 'array-contains']].map(([field, operator]) => list('meetings', [{ field, operator, value: employeeId }, { field: 'scheduledStart', operator: '>=', value: new Date() }], [{ field: 'scheduledStart', direction: 'asc' }], 10)))
    context.myUpcomingMeetings = unique(personalPages.flat()).filter(m => m.status !== 'cancelled').sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart)).slice(0, 5).map(m => ({ title: m.title, scheduledStart: m.scheduledStart, status: m.status }))
    const rows = isAdmin && !personal ? await list('meetings', [], sort('scheduledStart'), 10) : newest(unique((await Promise.all([['organizer', '=='], ['inviteeEmployeeIds', 'array-contains']].map(([field, operator]) => list('meetings', [{ field, operator, value: employeeId }], sort('scheduledStart'), 10)))).flat()), 'scheduledStart', 10)
    const refs = await readFirestoreReferences(database, 'employees', rows.map(m => m.organizer))
    context.meetings = rows.map(m => ({ title: m.title, date: m.scheduledStart, status: m.status, organizer: name(refs.get(idOf(m.organizer))) }))
  })
  await Promise.all(jobs)
  return context
}
