import { getFirestoreSystemDatabase } from '@/lib/platform/firestoreApplication.server'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'
import { getMeetingDatabase, meetingFilter } from './store.server'

export function tenantFromGuestLink(link) {
  if (link.startsWith('v2.')) {
    const value = Buffer.from(link.split('.')[1] || '', 'base64url').toString('utf8')
    return /^talio_company_[a-zA-Z0-9_-]+$/.test(value) ? value : null
  }
  if (link.startsWith('guest-')) return null
  const parts = link.split('-'), index = parts.findIndex(part => /^\d{13}$/.test(part))
  return index > 0 ? `talio_${parts.slice(0, index).join('-')}` : null
}
export async function findGuestMeeting(link) {
  if (typeof link !== 'string' || link.length > 300 || !link) return null
  const direct = tenantFromGuestLink(link)
  const find = async databaseName => {
    const database = await getMeetingDatabase(databaseName)
    const meeting = (await database.list('meetings', { filters: [meetingFilter('guestAccess.guestLink', link)], limit: 1 })).records[0]
    return meeting?.guestAccess?.enabled ? { meeting, database, databaseName } : null
  }
  // Embedded tenant names never fall back to another tenant if the link is invalid.
  if (direct) return find(direct)
  if (!link.startsWith('guest-')) return null
  // Compatibility for imported bearer links: exact link lookup within each
  // registered active tenant, never a scan of meeting documents.
  const system = await getFirestoreSystemDatabase({ queryFields: { tenantcompanies: ['isActive'] } })
  for (const tenant of await collectFirestorePages(system, 'tenantcompanies', { filters: [meetingFilter('isActive', true)] }, 1000)) {
    if (!tenant.databaseName) continue
    const found = await find(tenant.databaseName)
    if (found) return found
  }
  return null
}
