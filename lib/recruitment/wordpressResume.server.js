import mongoose from 'mongoose'
import { getTenantConnection } from '@/lib/tenantDb'
import { getImage, getImageInfo } from '@/lib/gridfs'
import { getTenantBlob, buildTenantRootPrefix } from '@/lib/platform/blobStorage.server'
import { digest, syncError, serializeApplication } from './wordpress.server'

export const RESUME_CHUNK_SIZE = 256 * 1024
export const MAX_RESUME_BYTES = 25 * 1024 * 1024
const types = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
const asBuffer = value => Buffer.isBuffer(value) ? value : Buffer.from(value.buffer)
async function collections(auth) {
  const connection = await getTenantConnection(auth.tenant.databaseName)
  return { uploads: connection.db.collection('recruitmentResumeUploads'), files: connection.db.collection('recruitmentResumes.files'), chunks: connection.db.collection('recruitmentResumes.chunks') }
}
async function candidate(auth, id) {
  if (!mongoose.Types.ObjectId.isValid(String(id || ''))) throw syncError('Invalid application')
  const record = await auth.models.Candidate.findById(id).lean()
  if (!record) throw syncError('Application not found', 404)
  return record
}
export async function prepareResume(auth, input) {
  const record = await candidate(auth, input.candidateId)
  if (record.wordpress?.connectionId !== auth.integration.connectionId) throw syncError('Resume does not belong to this connection', 403)
  const name = String(input.name || '').split(/[\\/]/).pop().replace(/[\r\n"<>]/g, '').slice(0, 200)
  const extension = name.split('.').pop().toLowerCase(), size = Number(input.size)
  if (!types[extension] || !Number.isInteger(size) || size < 1 || size > MAX_RESUME_BYTES || !/^[a-f0-9]{64}$/.test(input.sha256 || '')) throw syncError('Use a PDF, DOC or DOCX resume up to 25 MB with a valid checksum')
  const { uploads, chunks } = await collections(auth)
  // Deterministic identifiers make interrupted/replayed uploads safe even without autoIndex.
  const id = new mongoose.Types.ObjectId(digest(`${record._id}:${input.sha256}`).slice(0, 24))
  await chunks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await uploads.updateOne({ _id: id }, { $setOnInsert: { candidateId: record._id, name, type: types[extension], size, sha256: input.sha256, previousResume: digest(JSON.stringify(record.resume || null)), createdAt: new Date() } }, { upsert: true })
  return { uploadId: String(id), chunkSize: RESUME_CHUNK_SIZE, chunks: Math.ceil(size / RESUME_CHUNK_SIZE) }
}
export async function receiveResumeChunk(auth, input) {
  if (!mongoose.Types.ObjectId.isValid(input.uploadId || '')) throw syncError('Invalid upload')
  const { uploads, chunks } = await collections(auth)
  const upload = await uploads.findOne({ _id: new mongoose.Types.ObjectId(input.uploadId) })
  if (!upload) throw syncError('Upload not found', 404)
  const record = await candidate(auth, String(upload.candidateId))
  if (record.wordpress?.connectionId !== auth.integration.connectionId) throw syncError('Upload belongs to another connection', 403)
  const index = Number(input.index), bytes = Buffer.from(String(input.data || ''), 'base64')
  const count = Math.ceil(upload.size / RESUME_CHUNK_SIZE)
  if (!Number.isInteger(index) || index < 0 || index >= count || bytes.length !== Math.min(RESUME_CHUNK_SIZE, upload.size - index * RESUME_CHUNK_SIZE)) throw syncError('Invalid resume chunk')
  const chunkId = `${upload._id}:${index}`, checksum = digest(bytes)
  const existing = await chunks.findOne({ _id: chunkId })
  if (existing && existing.checksum !== checksum) throw syncError('Resume chunk differs from the previous upload', 409)
  await chunks.updateOne({ _id: chunkId }, { $setOnInsert: { files_id: upload._id, n: index, data: bytes, checksum, expiresAt: new Date(Date.now() + 86400000) } }, { upsert: true })
  return { received: index }
}
export async function completeResume(auth, input) {
  if (!mongoose.Types.ObjectId.isValid(input.uploadId || '')) throw syncError('Invalid upload')
  const { uploads, chunks, files } = await collections(auth)
  const upload = await uploads.findOne({ _id: new mongoose.Types.ObjectId(input.uploadId) })
  if (!upload) throw syncError('Upload not found', 404)
  const record = await candidate(auth, String(upload.candidateId))
  if (record.wordpress?.connectionId !== auth.integration.connectionId) throw syncError('Upload belongs to another connection', 403)
  if (String(record.wordpress?.resumeFileId) !== String(upload._id) && upload.previousResume !== digest(JSON.stringify(record.resume || null))) throw syncError('The resume changed in Talio during this upload. Review the conflict before retrying.', 409)
  const parts = await chunks.find({ files_id: upload._id }).sort({ n: 1 }).toArray()
  const bytes = Buffer.concat(parts.map(part => asBuffer(part.data)))
  if (bytes.length !== upload.size || digest(bytes) !== upload.sha256) throw syncError('Resume is incomplete or corrupted. Retry the upload.', 409)
  const validSignature = upload.type === types.pdf ? bytes.subarray(0, 5).toString() === '%PDF-' : upload.type === types.docx ? bytes.subarray(0, 2).toString() === 'PK' : bytes.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1'
  if (!validSignature) throw syncError('Resume content does not match its file type')
  await files.updateOne({ _id: upload._id }, { $setOnInsert: { length: upload.size, chunkSize: RESUME_CHUNK_SIZE, uploadDate: new Date(), filename: upload.name, contentType: upload.type, metadata: { candidateId: record._id } } }, { upsert: true })
  await chunks.updateMany({ files_id: upload._id }, { $unset: { expiresAt: '' } })
  const url = `/api/recruitment/candidates/${record._id}/resume`
  if (String(record.wordpress?.resumeFileId) === String(upload._id) && !record.wordpress?.resumePending) return serializeApplication(record)
  const saved = await auth.models.Candidate.findOneAndUpdate({ _id: record._id, updatedAt: record.updatedAt }, { $set: { resume: { name: upload.name, url, uploadedAt: new Date() }, 'wordpress.resumeFileId': String(upload._id), 'wordpress.resumePending': false } }, { new: true }).lean()
  if (!saved) throw syncError('Application changed while finalizing the resume. Retry.', 409)
  return serializeApplication(saved)
}

export async function readCandidateResume(auth, id) {
  const record = await candidate(auth, id)
  const url = String(record.resume?.url || '')
  let bytes, name = record.resume?.name || 'resume', type = 'application/octet-stream'
  if (record.wordpress?.resumeFileId && url === `/api/recruitment/candidates/${record._id}/resume`) {
    const { files, chunks } = await collections(auth)
    const file = await files.findOne({ _id: new mongoose.Types.ObjectId(record.wordpress.resumeFileId), 'metadata.candidateId': record._id })
    if (!file || file.length > MAX_RESUME_BYTES) throw syncError('Resume is unavailable', 404)
    const parts = await chunks.find({ files_id: file._id }).sort({ n: 1 }).toArray()
    bytes = Buffer.concat(parts.map(part => asBuffer(part.data))); name = file.filename; type = file.contentType
    if (bytes.length !== file.length) throw syncError('Resume upload is incomplete', 409)
  } else if (/^\/api\/images\/[a-f0-9]{24}$/i.test(url)) {
    const fileId = url.split('/').pop(), info = await getImageInfo(fileId)
    if (!info || info.length > MAX_RESUME_BYTES) throw syncError('Resume is unavailable', 404)
    // Only an upload by a user in this tenant can be exported from the legacy shared bucket.
    const { User } = await (await import('@/lib/tenantModels')).getTenantModels(auth.tenant.databaseName, ['User'])
    if (!info.metadata?.userId || !await User.exists({ _id: info.metadata.userId })) throw syncError('Resume belongs to another organisation', 403)
    bytes = await getImage(fileId); type = info.metadata.contentType || type
  } else {
    let path
    if (url.startsWith('/api/files/')) path = decodeURIComponent(url.slice('/api/files/'.length))
    else {
      try { const parsed = new URL(url); if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.blob.vercel-storage.com')) path = decodeURIComponent(parsed.pathname.slice(1)) } catch { /* unsupported legacy URL */ }
    }
    if (!path?.startsWith(`${buildTenantRootPrefix(auth.tenant.databaseName)}/`) || path.includes('..')) throw syncError('Re-upload this resume into Talio secure storage before sharing it with WordPress', 409)
    const blob = await getTenantBlob(path)
    if (!blob?.stream || blob.blob.size > MAX_RESUME_BYTES) throw syncError('Resume is unavailable', 404)
    bytes = Buffer.from(await new Response(blob.stream).arrayBuffer()); type = blob.blob.contentType || type
  }
  if (!bytes?.length || bytes.length > MAX_RESUME_BYTES) throw syncError('Resume is unavailable', 404)
  return { bytes, name, type }
}
