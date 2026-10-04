import { getFirestoreTenantDatabase } from './firestoreApplication.server'
import { formatDesignation, formatDepartments } from '@/lib/formatters'

export async function getProductivityEmployeeContext(databaseName, userId) {
  const store = await getFirestoreTenantDatabase(databaseName, { queryFields: { taskassignees: ['user', 'assignmentStatus'] } })
  const user = await store.get('users', String(userId))
  const employee = user?.employeeId ? await store.get('employees', String(user.employeeId)) : null
  if (employee) {
    if (employee.designation) employee.designation = await store.get('designations', String(employee.designation))
    if (employee.department) employee.department = await store.get('departments', String(employee.department))
    if (employee.departments?.length) employee.departments = (await store.getMany('departments', employee.departments.slice(0, 100).map(String))).filter(Boolean)
  }
  const manual = Array.isArray(employee?.manualKRIs) ? employee.manualKRIs.filter(Boolean) : []
  const generated = Array.isArray(employee?.aiGeneratedKRIs) ? employee.aiGeneratedKRIs.filter(value => value && (value.title || value.description)).map(value => [value.title, value.description && `— ${value.description}`, value.importance && value.importance !== 'medium' && `(${value.importance} priority)`].filter(Boolean).join(' ')) : []
  let taskContextStr = 'No active tasks assigned'
  if (employee) {
    const assignments = []
    let cursor
    do {
      const page = await store.list('taskassignees', { filters: [{ field: 'user', operator: 'in', value: [...new Set([String(employee._id), String(userId)])] }, { field: 'assignmentStatus', operator: 'in', value: ['pending', 'accepted'] }], limit: 100, cursor })
      assignments.push(...page.records); cursor = page.nextCursor
      if (assignments.length >= 1000) break
    } while (cursor)
    const ids = [...new Set(assignments.map(value => value.task).filter(Boolean).map(String))], tasks = []
    for (let offset = 0; offset < ids.length; offset += 100) tasks.push(...(await store.getMany('tasks', ids.slice(offset, offset + 100))).filter(task => task && ['todo', 'in-progress', 'review'].includes(task.status)))
    tasks.sort((a, b) => String(b.priority).localeCompare(String(a.priority)) || new Date(a.dueDate || 8640000000000000) - new Date(b.dueDate || 8640000000000000))
    const selected = tasks.slice(0, 10)
    if (selected.length) {
      const projects = new Map()
      for (const projectId of new Set(selected.map(task => task.project).filter(Boolean).map(String))) projects.set(projectId, await store.get('projects', projectId))
      taskContextStr = selected.map((task, index) => `${index + 1}. [${task.status.toUpperCase()}] "${task.title}" (Project: ${projects.get(String(task.project))?.name || 'No Project'}, Priority: ${task.priority}, Due: ${task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date'})`).join('\n')
    }
  }
  return {
    employeeName: employee ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || user?.name || 'Employee' : user?.name || 'Employee',
    employeeRole: user?.role || 'employee',
    employeeDesignation: employee ? formatDesignation(employee.designation, employee) || employee.jobTitle || '' : '',
    employeeDepartment: employee ? formatDepartments(employee) || '' : '',
    employeeRecordId: employee?._id || null,
    kris: [...manual.map(String), ...generated].slice(0, 12),
    kpis: Array.isArray(employee?.manualKPIs) ? employee.manualKPIs.filter(value => value && (value.name || value.target)).map(value => ({ name: value.name || '', target: value.target || '', unit: value.unit || '', notes: value.notes || '' })) : [],
    taskContextStr,
  }
}
