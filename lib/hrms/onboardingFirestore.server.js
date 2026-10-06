import { createHash } from 'node:crypto'
import { hydrateEmployeeLifecycle } from './employeeLifecycle.server'
import { normalizeOnboardingVerification } from './onboardingVerification'
import { recordDigest } from '../platform/firestoreCodec.cjs'

/** Persist the checklist and all evidence references as one atomic submission. */
export async function submitOnboarding(database, { employee, userId, itemKey, verification, linkedEvidence, validateFiles }) {
  const normalized = normalizeOnboardingVerification(itemKey, verification, { submission: true, employee, linkedEvidence }).verification
  if (!normalized.documents.length && !Object.values(normalized.details).some(value => value !== false && String(value).trim())) throw new Error('Add a file or complete your details before submitting')
  normalized.documents = await validateFiles(normalized.documents)
  if (normalized.documents.length > 40) throw new Error('Submit at most 40 files at a time')
  const now = new Date()
  const previous = recordDigest({ lifecycle: employee.lifecycle, version: employee.__v })
  return database.transaction(async tx => {
    const current = await tx.get('employees', String(employee._id))
    const account = await tx.get('users', String(userId))
    if (!current || String(account?.employeeId) !== String(employee._id)) throw new Error('Employee profile is no longer linked to your account')
    if (recordDigest({ lifecycle: current.lifecycle, version: current.__v }) !== previous) throw Object.assign(new Error('Your onboarding record changed. Refresh and submit again.'), { status: 409 })
    const lifecycle = hydrateEmployeeLifecycle(current)
    const item = lifecycle.onboarding.checklist.find(entry => entry.key === itemKey)
    if (!item || item.completed) throw Object.assign(new Error('This onboarding item is already verified or is not available'), { status: 409 })
    const documents = []
    const seen = new Set()
    for (const file of normalized.documents) {
      // A combined PDF can legitimately satisfy multiple checklist entries.
      // Keep all verification entries but only one document-register record.
      if (seen.has(file.fileId)) continue
      seen.add(file.fileId)
      const matches = await tx.list('documents', { filters: [
        { field: 'employee', operator: '==', value: String(employee._id) },
        { field: 'fileId', operator: '==', value: file.fileId },
      ], limit: 2, requireComplete: true })
      if (matches.records.length > 1) throw new Error('Duplicate document records must be reconciled before resubmission')
      const existing = matches.records[0]
      const record = {
        ...existing, _id: existing?._id || createHash('sha256').update(JSON.stringify([employee._id, file.fileId])).digest('hex').slice(0, 24),
        employee: employee._id, uploadedBy: existing?.uploadedBy || employee._id, fileId: file.fileId,
        name: file.fileName, fileName: file.fileName, type: file.fileType, fileType: file.fileType, url: file.fileUrl, fileUrl: file.fileUrl,
        fileSize: file.fileSize, category: `onboarding_${file.requirementKey}`, status: 'pending', onboardingItemKey: item.key,
        isActive: true, createdAt: existing?.createdAt || now, updatedAt: now,
      }
      documents.push({ existing, record })
    }
    item.submission = { status: 'pending', verification: normalized, submittedAt: now, submittedBy: userId, reviewReason: '' }
    await tx.replace('employees', { ...current, lifecycle, __v: (current.__v || 0) + 1, updatedAt: now })
    for (const { existing, record } of documents) {
      if (existing) await tx.replace('documents', record)
      else await tx.create('documents', record)
    }
    return normalized
  })
}
