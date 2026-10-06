import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getFirestoreMembershipBatchSize } from '@/lib/platform/firestoreStore.server'
import { workflowMatchesSearch } from './workflowSearch'

export const WORKFLOW_QUERY_FIELDS = ['subjectEmployee', 'module', 'status', 'createdAt', 'owner', 'createdBy', 'assignees', 'confidential', 'idempotencyKey', 'searchGrams']
const id = value => String(value?._id || value || '')
export function getWorkflowStore(auth) {
  if (!auth?.success || !auth.user || !auth.tenant?.databaseName) throw new Error('Verified tenant required')
  return getFirestoreTenantDatabase(auth.tenant.databaseName, {
    queryFields: { hrmsworkflows: WORKFLOW_QUERY_FIELDS, hrmsworkflowevents: ['workflow', 'createdAt'] },
    constraints: { hrmsworkflows: [{ fields: ['idempotencyKey'], sparse: true }, { fields: ['caseNumber'] }] },
  })
}

export function canReadWorkflow(user, workflow) {
  if (['admin', 'hr', 'superadmin', 'super_admin'].includes(user?.role)) return true
  const userId = id(user.id || user._id)
  if (['manager', 'department_head'].includes(user?.role) && workflow.confidential !== true) return true
  return [workflow.owner, workflow.createdBy, ...(workflow.assignees || [])].some(value => id(value) === userId) || (Boolean(user.employeeId) && id(workflow.subjectEmployee) === id(user.employeeId))
}

export async function populateWorkflow(database, workflow, detail = false) {
  const userFields = user => user ? { _id: user._id, email: user.email, role: user.role, employeeId: user.employeeId } : null
  const employee = workflow.subjectEmployee ? await database.get('employees', id(workflow.subjectEmployee)) : null
  const result = { ...workflow, subjectEmployee: employee ? { _id: employee._id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode, profilePicture: employee.profilePicture } : null }
  for (const field of detail ? ['owner', 'createdBy', 'updatedBy'] : ['owner']) result[field] = workflow[field] ? userFields(await database.get('users', id(workflow[field]))) : null
  if (detail) result.assignees = await Promise.all((workflow.assignees || []).map(async userId => userFields(await database.get('users', id(userId)))))
  return result
}

export async function listVisibleWorkflows(database, user, { modules, status, search = '' }) {
  if (!modules.length) return []
  const common = []
  if (status) common.push({ field: 'status', operator: '==', value: status })
  const access = ['admin', 'hr', 'superadmin', 'super_admin'].includes(user.role) ? [[]] : [
    [{ field: 'owner', operator: '==', value: id(user.id || user._id) }],
    [{ field: 'createdBy', operator: '==', value: id(user.id || user._id) }],
    [{ field: 'assignees', operator: 'array-contains', value: id(user.id || user._id) }],
    ...(user.employeeId ? [[{ field: 'subjectEmployee', operator: '==', value: id(user.employeeId) }]] : []),
    ...(['manager', 'department_head'].includes(user.role) ? [[{ field: 'confidential', operator: '==', value: false }]] : []),
  ]
  // Firestore permits only one array-contains clause. Text search narrows by an
  // indexed gram first, then the exact visibility predicate protects output.
  const scopes = search ? [[{ field: 'searchGrams', operator: 'array-contains', value: search.toLocaleLowerCase('en-US').slice(0, 3) }]] : access
  const moduleChunks = []
  const batchSize = Math.min(...scopes.map(scope => getFirestoreMembershipBatchSize([...common, ...scope], [{ field: 'createdAt', direction: 'desc' }])))
  for (let index = 0; index < modules.length; index += batchSize) moduleChunks.push(modules.slice(index, index + batchSize))
  const matches = await Promise.all(moduleChunks.flatMap(chunk => scopes.map(async scope => {
    const values = []; let cursor
    do {
      const page = await database.list('hrmsworkflows', { filters: [{ field: 'module', operator: 'in', value: chunk }, ...common, ...scope], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 100, cursor })
      values.push(...page.records.filter(record => canReadWorkflow(user, record) && (!search || workflowMatchesSearch(record, search))))
      cursor = page.nextCursor
    } while (cursor)
    return values
  })))
  return [...new Map(matches.flat().map(record => [id(record), record])).values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || id(b).localeCompare(id(a)))
}
