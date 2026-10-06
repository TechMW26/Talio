import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { RECRUITMENT_STORE_OPTIONS, saveCandidate } from '@/lib/recruitment/store.server'

export async function upsertCandidate(tenant, candidateData, options = {}) {
  const databaseName = typeof tenant === 'string' ? tenant : tenant?.databaseName
  const database = options.database || await getFirestoreTenantDatabase(databaseName, RECRUITMENT_STORE_OPTIONS)
  return saveCandidate(database, { ...candidateData, totalExperience: candidateData.totalExperience ?? candidateData.experience }, { _id: options.actorId || candidateData.createdBy, employeeId: options.actorId || candidateData.createdBy }, null, options.applicationNote)
}
