import { getImageInfo } from '@/lib/mediaStorage'
import { buildAuthenticatedBlobUrl, buildTenantBlobPrefix, getTenantBlob } from '@/lib/platform/blobStorage.server'
import { MAX_UPLOAD_SIZE_BYTES } from '@/lib/platform/uploadPolicy'

/** Resolve evidence from this user's uploads or this employee's existing register. */
export async function validateOnboardingFiles(auth, employeeId, documents) {
  const owner = String(auth.user._id || auth.user.userId)
  const prefix = `${buildTenantBlobPrefix({ tenantId: auth.tenant.databaseName, ownerId: owner, category: 'documents' })}/`
  const result = []
  for (const document of documents) {
    const { records } = await auth.database.list('documents', { filters: [
      { field: 'employee', operator: '==', value: String(employeeId) },
      { field: 'fileId', operator: '==', value: document.fileId },
    ], limit: 100 })
    const existing = records.find(record => record.status === 'approved' && record.isActive !== false)
    if (existing) {
      result.push({ ...document, fileUrl: existing.fileUrl || existing.url, fileSize: existing.fileSize, fileType: existing.fileType || existing.type })
      continue
    }
    let fileUrl, fileSize, fileType
    if (/^[a-f\d]{24}$/i.test(document.fileId)) {
      const info = await getImageInfo(document.fileId, { databaseName: auth.tenant.databaseName })
      if (!info || String(info.metadata?.userId) !== owner || info.metadata?.category !== 'documents') throw new Error('An uploaded file does not belong to you. Please upload it again.')
      fileUrl = `/api/images/${document.fileId}`; fileSize = info.length; fileType = info.contentType
    } else {
      if (!document.fileId.startsWith(prefix) || document.fileId.includes('..')) throw new Error('An uploaded file is outside your document storage')
      const blob = await getTenantBlob(document.fileId)
      if (!blob?.blob) throw new Error('An uploaded file is missing. Please upload it again.')
      fileUrl = buildAuthenticatedBlobUrl(document.fileId); fileSize = blob.blob.size; fileType = blob.blob.contentType
      await blob.stream?.cancel?.()
    }
    if (!fileSize || fileSize > MAX_UPLOAD_SIZE_BYTES) throw new Error('Evidence files must be between 1 byte and 25 MB')
    result.push({ ...document, fileUrl, fileSize, fileType })
  }
  return result
}
