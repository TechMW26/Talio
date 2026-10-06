import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'

/** Access to private employee uploads, including files not yet submitted to HR. */
export async function canReadDocumentUpload(auth, { fileId, ownerId }) {
  if (!auth?.success || !auth.user || !auth.tenant?.databaseName) return false
  const actorId = String(auth.user._id || auth.user.userId || '')
  if (ownerId && actorId === String(ownerId)) return true
  const store = await getFirestoreTenantDatabase(auth.tenant.databaseName, { queryFields: { documents: ['fileId'] } })
  const owner = /^[a-f\d]{24}$/i.test(ownerId || '') ? await store.get('users', String(ownerId)) : null
  if (!owner) return false
  if (['admin', 'hr', 'super_admin', 'superadmin'].includes(auth.user.role)) {
    // Privileged access still needs an owner in this verified tenant.
    return true
  }
  const actor = await store.get('users', actorId)
  if (!actor?.employeeId) return false
  const issuedByHr = ['admin', 'hr', 'super_admin', 'superadmin'].includes(owner.role)
  let cursor
  do {
    // The indexed file ID narrows this lookup to versions/references for exactly
    // one upload; role/owner checks never require a collection scan.
    const page = await store.list('documents', { filters: [{ field: 'fileId', operator: '==', value: String(fileId) }], limit: 100, cursor })
    if (page.records.some(document => document.isActive !== false && (['approved', 'issued'].includes(document.status) || (issuedByHr && document.status === undefined)) && (String(document.employee) === String(actor.employeeId) || document.isCompanyDocument === true))) return true
    cursor = page.nextCursor
  } while (cursor)
  return false
}
