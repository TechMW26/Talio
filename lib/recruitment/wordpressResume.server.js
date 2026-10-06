import { getImage, getImageInfo } from '@/lib/mediaStorage'
import { getTenantBlob, uploadTenantBlob, deleteTenantBlob, buildTenantRootPrefix } from '@/lib/platform/blobStorage.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getFirestoreMediaRepository } from '@/lib/platform/firestoreMedia.server'
import { digest, syncError, serializeApplication } from './wordpress.server'

export const RESUME_CHUNK_SIZE = 256 * 1024
export const MAX_RESUME_BYTES = 25 * 1024 * 1024
const types = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
const validId = value => /^[a-f0-9]{24}$/i.test(String(value || ''))
const UPLOADS = 'recruitmentResumeUploads'
const options = auth => ({ databaseName: auth.tenant.databaseName })
async function candidate(auth, id) {
  if (!validId(id)) throw syncError('Invalid application')
  const record = await (await getFirestoreTenantDatabase(auth.tenant.databaseName)).get('candidates', String(id))
  if (!record) throw syncError('Application not found', 404)
  return record
}
async function uploadContext(auth, id) {
  if (!validId(id)) throw syncError('Invalid upload')
  const store = await getFirestoreTenantDatabase(auth.tenant.databaseName)
  const upload = await store.get(UPLOADS, id)
  if (!upload) throw syncError('Upload not found', 404)
  const record = await candidate(auth, String(upload.candidateId))
  if (record.wordpress?.connectionId !== auth.integration.connectionId) throw syncError('Upload belongs to another connection', 403)
  return { store, upload, record }
}
export async function prepareResume(auth, input) {
  const record = await candidate(auth, input.candidateId)
  if (record.wordpress?.connectionId !== auth.integration.connectionId) throw syncError('Resume does not belong to this connection', 403)
  const name = String(input.name || '').split(/[\\/]/).pop().replace(/[\r\n"<>]/g, '').slice(0, 200)
  const extension = name.split('.').pop().toLowerCase(), size = Number(input.size)
  if (!types[extension] || !Number.isInteger(size) || size < 1 || size > MAX_RESUME_BYTES || !/^[a-f0-9]{64}$/.test(input.sha256 || '')) throw syncError('Use a PDF, DOC or DOCX resume up to 25 MB with a valid checksum')
  const store = await getFirestoreTenantDatabase(auth.tenant.databaseName)
  const id = digest(`${record._id}:${input.sha256}`).slice(0, 24)
  await store.transaction(async tx => {
    const existing = await tx.get(UPLOADS, id)
    if (existing) {
      if (existing.size !== size || existing.type !== types[extension]) throw syncError('Upload metadata differs from the existing upload', 409)
      return
    }
    await tx.create(UPLOADS, { _id: id, candidateId: String(record._id), name, type: types[extension], size, sha256: input.sha256, previousResume: digest(JSON.stringify(record.resume || null)), createdAt: new Date(), parts: {} })
  })
  return { uploadId: id, chunkSize: RESUME_CHUNK_SIZE, chunks: Math.ceil(size / RESUME_CHUNK_SIZE) }
}
export async function receiveResumeChunk(auth, input) {
  const { store, upload } = await uploadContext(auth, input.uploadId)
  const index = Number(input.index), bytes = Buffer.from(String(input.data || ''), 'base64')
  const count = Math.ceil(upload.size / RESUME_CHUNK_SIZE)
  if (!Number.isInteger(index) || index < 0 || index >= count || bytes.length !== Math.min(RESUME_CHUNK_SIZE, upload.size - index * RESUME_CHUNK_SIZE)) throw syncError('Invalid resume chunk')
  const checksum = digest(bytes), key = `p${index}`
  if (upload.parts?.[key]) {
    if (upload.parts[key].checksum !== checksum) throw syncError('Resume chunk differs from the previous upload', 409)
    return { received: index }
  }
  const blob = await uploadTenantBlob({ tenantId: auth.tenant.databaseName, category: 'resume-parts', ownerId: input.uploadId, filename: `${index}.part`, body: bytes, contentType: 'application/octet-stream', access: 'private' })
  let kept = false
  try {
    kept = await store.transaction(async tx => {
      const current = await tx.get(UPLOADS, input.uploadId)
      if (!current) throw syncError('Upload not found', 404)
      const prior = current.parts?.[key]
      if (prior) {
        if (prior.checksum !== checksum) throw syncError('Resume chunk differs from the previous upload', 409)
        return false
      }
      await tx.replace(UPLOADS, { ...current, parts: { ...current.parts, [key]: { pathname: blob.pathname, checksum, size: bytes.length } } })
      return true
    })
  } finally { if (!kept) await deleteTenantBlob(blob.pathname).catch(() => {}) }
  return { received: index }
}
export async function completeResume(auth, input) {
  const { store, upload, record } = await uploadContext(auth, input.uploadId)
  const url = `/api/recruitment/candidates/${record._id}/resume`
  if (String(record.wordpress?.resumeFileId) === upload.mediaId && !record.wordpress?.resumePending) return serializeApplication(record)
  if (upload.previousResume !== digest(JSON.stringify(record.resume || null))) throw syncError('The resume changed in Talio during this upload. Review the conflict before retrying.', 409)
  const repository = await getFirestoreMediaRepository(auth.tenant.databaseName)
  let mediaId = upload.mediaId
  if (!mediaId) {
    const parts = []
    for (let index = 0; index < Math.ceil(upload.size / RESUME_CHUNK_SIZE); index++) {
      const part = upload.parts?.[`p${index}`]
      const prefix = `${buildTenantRootPrefix(auth.tenant.databaseName)}/resume-parts/${input.uploadId}/`
      if (!part?.pathname?.startsWith(prefix) || part.pathname.includes('..')) throw syncError('Resume is incomplete. Retry the upload.', 409)
      const blob = await getTenantBlob(part.pathname, { access: 'private' })
      if (!blob?.stream) throw syncError('Resume part is unavailable. Retry the upload.', 409)
      const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer())
      if (bytes.length !== part.size || digest(bytes) !== part.checksum) throw syncError('Resume chunk is corrupted', 409)
      parts.push(bytes)
    }
    const bytes = Buffer.concat(parts)
    if (bytes.length !== upload.size || digest(bytes) !== upload.sha256) throw syncError('Resume is incomplete or corrupted. Retry the upload.', 409)
    const validSignature = upload.type === types.pdf ? bytes.subarray(0, 5).toString() === '%PDF-' : upload.type === types.docx ? bytes.subarray(0, 2).toString() === 'PK' : bytes.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1'
    if (!validSignature) throw syncError('Resume content does not match its file type')
    const createdId = await repository.save('recruitmentResumes', { bytes, filename: upload.name, contentType: upload.type, metadata: { candidateId: String(record._id) } })
    try {
      mediaId = await store.transaction(async tx => {
        const current = await tx.get(UPLOADS, input.uploadId)
        if (current.mediaId) return current.mediaId
        await tx.replace(UPLOADS, { ...current, mediaId: createdId })
        return createdId
      })
    } catch (error) { await repository.remove('recruitmentResumes', createdId); throw error }
    if (mediaId !== createdId) await repository.remove('recruitmentResumes', createdId)
  }
  const saved = await store.transaction(async tx => {
    const current = await tx.get('candidates', String(record._id))
    if (!current || new Date(current.updatedAt).getTime() !== new Date(record.updatedAt).getTime()) return null
    const next = { ...current, resume: { name: upload.name, url, uploadedAt: new Date() }, wordpress: { ...current.wordpress, resumeFileId: mediaId, resumePending: false }, updatedAt: new Date() }
    await tx.replace('candidates', next)
    return next
  })
  if (!saved) throw syncError('Application changed while finalizing the resume. Retry.', 409)
  // The final private file is independent from upload pieces; keep its manifest
  // for replay/conflict detection but dispose of intermediate binary objects.
  await Promise.all(Object.values(upload.parts || {}).map(part => deleteTenantBlob(part.pathname).catch(() => {})))
  return serializeApplication(saved)
}

export async function readCandidateResume(auth, id) {
  const record = await candidate(auth, id)
  const url = String(record.resume?.url || '')
  let bytes, name = record.resume?.name || 'resume', type = 'application/octet-stream'
  if (record.wordpress?.resumeFileId && url === `/api/recruitment/candidates/${record._id}/resume`) {
    const repository = await getFirestoreMediaRepository(auth.tenant.databaseName)
    const result = await repository.open('recruitmentResumes', String(record.wordpress.resumeFileId), file => String(file.metadata?.candidateId) === String(record._id) && file.length <= MAX_RESUME_BYTES)
    if (!result) throw syncError('Resume is unavailable', 404)
    bytes = Buffer.from(await new Response(result.stream).arrayBuffer()); name = result.file.filename; type = result.contentType
  } else if (/^\/api\/images\/[a-f0-9]{24}$/i.test(url)) {
    const fileId = url.split('/').pop(), info = await getImageInfo(fileId, options(auth))
    if (!info || info.length > MAX_RESUME_BYTES) throw syncError('Resume is unavailable', 404)
    bytes = await getImage(fileId, options(auth)); type = info.contentType || info.metadata.contentType || type
  } else {
    let path
    if (url.startsWith('/api/files/')) path = decodeURIComponent(url.slice('/api/files/'.length))
    else {
      try { const parsed = new URL(url); if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.blob.vercel-storage.com')) path = decodeURIComponent(parsed.pathname.slice(1)) } catch { /* unsupported legacy URL */ }
    }
    if (!path?.startsWith(`${buildTenantRootPrefix(auth.tenant.databaseName)}/`) || path.includes('..')) throw syncError('Re-upload this resume into Talio secure storage before sharing it with WordPress', 409)
    const blob = await getTenantBlob(path, { access: 'private' })
    if (!blob?.stream || blob.blob.size > MAX_RESUME_BYTES) throw syncError('Resume is unavailable', 404)
    bytes = Buffer.from(await new Response(blob.stream).arrayBuffer()); type = blob.blob.contentType || type
  }
  if (!bytes?.length || bytes.length > MAX_RESUME_BYTES) throw syncError('Resume is unavailable', 404)
  return { bytes, name, type }
}
