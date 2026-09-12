import { GridFSBucket, ObjectId } from 'mongodb'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getTenantConnection } from '@/lib/tenantDb'

// Leaves headroom below Vercel's 4.5 MB request limit for multipart framing.
export const MAX_AUDIO_SEGMENT_BYTES = 4 * 1024 * 1024
const AUDIO_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'])

export function validateAudioSegment(file, duration) {
  if (!file || typeof file.arrayBuffer !== 'function' || file.size <= 0) return 'An audio file is required'
  if (file.size > MAX_AUDIO_SEGMENT_BYTES) return 'Upload audio in segments of 4 MB or less'
  if (!AUDIO_TYPES.has(String(file.type).split(';')[0].toLowerCase())) return 'Unsupported audio format'
  if (!Number.isFinite(duration) || duration < 0) return 'Invalid audio duration'
  return null
}

async function getStorage(databaseName) {
  if (!databaseName) throw new Error('Tenant database is required')
  const connection = await getTenantConnection(databaseName)
  return { db: connection.db, bucket: new GridFSBucket(connection.db, { bucketName: 'meetingAudio' }) }
}

export async function saveMeetingAudio({ databaseName, meetingId, employeeId, file }) {
  const { bucket } = await getStorage(databaseName)
  const upload = bucket.openUploadStream('meeting-audio', {
    metadata: { meetingId: String(meetingId), employeeId: String(employeeId), contentType: file.type },
  })
  try {
    await pipeline(Readable.from(Buffer.from(await file.arrayBuffer())), upload)
  } catch (error) {
    await upload.abort().catch(() => {})
    throw error
  }
  return upload.id.toString()
}

export async function deleteMeetingAudio(databaseName, fileId) {
  const { bucket } = await getStorage(databaseName)
  await bucket.delete(new ObjectId(fileId))
}

export async function readMeetingAudio(databaseName, meetingId, fileId) {
  if (!ObjectId.isValid(fileId)) return null
  const { db, bucket } = await getStorage(databaseName)
  const file = await db.collection('meetingAudio.files').findOne({
    _id: new ObjectId(fileId), 'metadata.meetingId': String(meetingId),
  })
  if (!file) return null
  return { stream: Readable.toWeb(bucket.openDownloadStream(file._id)), file }
}
