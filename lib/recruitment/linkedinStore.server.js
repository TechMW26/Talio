import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { encryptSecret, isEncryptedSecret } from '@/lib/secretEncryption'
import { defaultCompanySettings } from '@/lib/companySettings.server'
import { RECRUITMENT_STORE_OPTIONS } from './store.server'

export function getLinkedInDatabase(databaseName) {
  return getFirestoreTenantDatabase(databaseName, { ...RECRUITMENT_STORE_OPTIONS, queryFields: { ...RECRUITMENT_STORE_OPTIONS.queryFields, candidates: [...RECRUITMENT_STORE_OPTIONS.queryFields.candidates, 'linkedinPublicIdentifier', 'sourceMetadata.applicantId'], jobpostings: [...RECRUITMENT_STORE_OPTIONS.queryFields.jobpostings, 'linkedinJobPostingId'] } })
}
export async function readLinkedInSettings(database) {
  const { records } = await database.list('companysettings', { limit: 2 })
  if (records.length > 1) throw new Error('Multiple company settings records require reconciliation')
  return records[0] || null
}
export async function updateLinkedInSettings(database, patch) {
  const prepared = { ...patch }
  for (const key of ['accessToken', 'refreshToken']) if (prepared[key] && !isEncryptedSecret(prepared[key])) prepared[key] = encryptSecret(prepared[key])
  return database.transaction(async tx => {
    const { records } = await tx.list('companysettings', { limit: 2, requireComplete: true })
    if (records.length > 1) throw new Error('Multiple company settings records require reconciliation')
    const previous = records[0], now = new Date()
    const record = previous || { ...defaultCompanySettings(), _id: 'company-settings', createdAt: now }
    const next = { ...record, updatedAt: now, integrations: { ...record.integrations, linkedin: { ...record.integrations?.linkedin, ...prepared } } }
    if (previous) await tx.replace('companysettings', next); else await tx.create('companysettings', next)
    return next
  })
}
