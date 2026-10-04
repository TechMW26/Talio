import { getAuthAndDatabase } from '@/lib/auth'
import { getProductivityVisibility, queryProductivityByIds, populateProductivityEmployees } from './firestoreProductivityView.server'
import { isScreenCaptureProtectedRole } from '@/lib/productivityPrivacy'
import { attendanceId, attendanceError } from './firestoreAttendance.server'
export const ACTIVITY_DATABASE_OPTIONS = { queryFields: {
  users: ['employeeId', 'isActive'], employees: ['status', 'department', 'departments', 'assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager'],
  departments: ['head', 'heads', 'isActive', 'parentDepartment'], activities: ['employee', 'createdAt', 'type'],
} }
export async function activityContext(request) {
  const auth = await getAuthAndDatabase(request, ACTIVITY_DATABASE_OPTIONS)
  if (!auth.success) throw attendanceError(auth.message || 'Unauthorized', 401)
  return auth
}
export async function activityTeam(database, user, departmentId) {
  if (departmentId && !/^[a-f0-9]{24}$/.test(departmentId)) throw attendanceError('Invalid department ID')
  const scope = await getProductivityVisibility(database, user, { includeSelf: true })
  const employees = scope.employees.filter(e => !departmentId || [e.department, ...(e.departments || [])].map(attendanceId).includes(departmentId))
  const [populated, users] = await Promise.all([populateProductivityEmployees(database, employees), queryProductivityByIds(database, 'users', 'employeeId', employees.map(e => e._id))])
  const byEmployee = new Map(users.map(u => [attendanceId(u.employeeId), u]))
  const team = populated.map(e => {
    const account = byEmployee.get(e._id)
    return { employeeId: e._id, userId: account?._id, name: [e.firstName, e.lastName].filter(Boolean).join(' '), employeeCode: e.employeeCode,
      department: e.department ? { _id: e.department._id, name: e.department.name, code: e.department.code } : null, role: account?.role, canCapture: account?.isActive !== false && !isScreenCaptureProtectedRole(account?.role) }
  }).filter(e => e.userId)
  if (!scope.current.employeeId) team.push({ employeeId: null, userId: scope.current._id, name: scope.current.email, role: scope.current.role, department: null, canCapture: !isScreenCaptureProtectedRole(scope.current.role) })
  const departments = scope.admin ? (await database.list('departments', { filters: [{ field:'isActive',operator:'==',value:true }], limit:100 })).records : scope.departments
  return { scope, team, departments: departments.map(d => ({_id:d._id,name:d.name,code:d.code})) }
}
export async function manualCapturePermissions(database, user) {
  const data = await activityTeam(database, user)
  const { scope } = data
  const isDepartmentHead = scope.departments.length > 0
  const canInitiateCapture = scope.admin || isDepartmentHead
  const employeeMap = new Map(scope.employees.map(e => [e._id, e]))
  const targetable = data.team.filter(e => {
    const employee = employeeMap.get(e.employeeId)
    return e.canCapture && e.userId !== scope.current._id && (scope.admin || scope.departments.some(d => [employee?.department, ...(employee?.departments || [])].map(attendanceId).includes(d._id)))
  })
  return { ...data, permissions: { canInitiateCapture, isProtectedFromCapture: isScreenCaptureProtectedRole(scope.current.role), captureScope: scope.admin ? 'all' : isDepartmentHead ? 'department' : 'none', role:scope.current.role, isDepartmentHead, departmentsHeaded:data.departments },
    targetableUsers:canInitiateCapture ? targetable.map(e => ({_id:e.userId,name:e.name,employeeCode:e.employeeCode,role:e.role})) : [] }
}
