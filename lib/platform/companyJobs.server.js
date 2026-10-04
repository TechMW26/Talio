import { randomBytes } from 'node:crypto'
import { getFirestoreSystemDatabase } from './firestoreApplication.server'
import { collectFirestorePages } from './firestoreQueries.server'
export const COMPANY_JOB_OPTIONS = { queryFields: { tenantcompanies: ['isActive', 'isSetupComplete', 'serviceStatus'] } }
export async function companyJobDatabase() { return getFirestoreSystemDatabase(COMPANY_JOB_OPTIONS) }
export async function listJobCompanies(database, { setupComplete = false, services } = {}) {
  const filters = [{ field: 'isActive', operator: '==', value: true }]
  if (setupComplete) filters.push({ field: 'isSetupComplete', operator: '==', value: true })
  if (services) filters.push({ field: 'serviceStatus', operator: 'in', value: services })
  return collectFirestorePages(database, 'tenantcompanies', { filters })
}
// Provider delivery stays outside transactions. A short lease prevents overlapping
// cron runs from sending the same reminder; only a confirmed send marks it complete.
export async function deliverCompanyJob(database, companyId, key, eligible, send, complete) {
  if (process.env.TALIO_LOCAL_ACCEPTANCE === '1') return { success: false, skipped: true, reason: 'local_acceptance' }
  const token = randomBytes(16).toString('hex'), now = new Date()
  const claimed = await database.mutate('tenantcompanies', companyId, row => {
    if (!row?.isActive || !eligible(row) || +new Date(row.notificationJobs?.[key]?.leaseUntil || 0) > +now) return row
    return { ...row, notificationJobs: { ...row.notificationJobs, [key]: { token, leaseUntil: new Date(+now + 300000) } } }
  })
  if (claimed?.notificationJobs?.[key]?.token !== token) return { success: false, skipped: true, reason: 'already_claimed_or_sent' }
  let result
  try { result = await send(claimed) } catch (error) { result = { success: false, reason: error.message } }
  await database.mutate('tenantcompanies', companyId, row => {
    if (!row || row.notificationJobs?.[key]?.token !== token) return row
    const next = result?.success ? complete(row) : row
    return { ...next, notificationJobs: { ...next.notificationJobs, [key]: { token, leaseUntil: null, completedAt: result?.success ? new Date() : null, failedAt: result?.success ? null : new Date() } } }
  })
  return result
}
