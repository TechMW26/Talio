// Missing observations remain unknown; they must not become poor performance.
export const employeeDashboardHref = id => `/dashboard/team/members/${encodeURIComponent(id)}`

export function buildEmployeeReportRows(employees = [], attendance = [], tasks = []) {
  const attendanceById = new Map(attendance.map(row => [String(row.employeeId), row]))
  const tasksById = new Map(tasks.map(row => [String(row.employeeId), row]))
  return employees.map(employee => ({ ...employee, attendance: attendanceById.get(String(employee.id)), tasks: tasksById.get(String(employee.id)) }))
}

export function employeeReportActions(rows = []) {
  return rows.flatMap(row => {
    const reasons = []
    if (row.tasks?.overdueTasks > 0) reasons.push(`${row.tasks.overdueTasks} overdue task${row.tasks.overdueTasks === 1 ? '' : 's'} — review deadlines`)
    if (row.attendance?.lateArrivals > 0) reasons.push(`${row.attendance.lateArrivals} late arrival${row.attendance.lateArrivals === 1 ? '' : 's'} — review attendance`)
    if (row.reviewCount === 0) reasons.push('No review recorded — schedule a check-in')
    return reasons.length ? [{ ...row, reasons }] : []
  }).sort((a,b) => (b.tasks?.overdueTasks || 0) - (a.tasks?.overdueTasks || 0))
}
