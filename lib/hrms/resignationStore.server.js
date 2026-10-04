import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { reconcileOffboardingAssetChecklist } from './offboardingAssets.server'
import { failure, idOf } from './resignation.server'

export function getResignationStore(auth) {
  if (!auth?.success || !auth.user || !auth.tenant?.databaseName) throw failure('Sign in required', 401)
  return getFirestoreTenantDatabase(auth.tenant.databaseName, {
    queryFields: {
      users: ['employeeId', 'role'], usersessions: ['user', 'isActive'], assets: ['assignedTo'],
      resignationrequests: ['employee', 'active', 'requestedBy', 'reviewers', 'updatedAt'],
    },
    constraints: { documents: [{ fields: ['sourceKey'], sparse: true }] },
  })
}

export async function loadExitAssets(store, employee) {
  const assigned = []
  let cursor
  do {
    const page = await store.list('assets', { filters: [{ field: 'assignedTo', operator: '==', value: idOf(employee) }], limit: 100, cursor })
    assigned.push(...page.records)
    cursor = page.nextCursor
  } while (cursor)
  const checklistIds = [...new Set((employee.lifecycle?.offboarding?.assetChecklist || []).map(item => idOf(item.asset)))].filter(id => /^[a-f\d]{24}$/i.test(id) && !assigned.some(asset => idOf(asset) === id))
  const historical = await Promise.all(checklistIds.map(id => store.get('assets', id)))
  return reconcileOffboardingAssetChecklist(employee.lifecycle?.offboarding, [...assigned, ...historical.filter(Boolean)], { employeeId: employee._id })
}
