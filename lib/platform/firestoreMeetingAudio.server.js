import { getFirestoreMediaRepository } from './firestoreMedia.server'

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

export async function saveMeetingAudio({ databaseName, meetingId, employeeId, file }) {
  const error = validateAudioSegment(file, 0)
  if (error) throw new TypeError(error)
  const repository = await getFirestoreMediaRepository(databaseName)
  return repository.save('meetingAudio', {
    bytes: Buffer.from(await file.arrayBuffer()), filename: 'meeting-audio', contentType: file.type,
    metadata: { meetingId: String(meetingId), employeeId: String(employeeId), contentType: file.type },
  })
}

export async function deleteMeetingAudio(databaseName, fileId) {
  return (await getFirestoreMediaRepository(databaseName)).remove('meetingAudio', fileId)
}

export async function readMeetingAudio(databaseName, meetingId, fileId) {
  if (!/^[a-f0-9]{24}$/.test(fileId || '')) return null
  const repository = await getFirestoreMediaRepository(databaseName)
  return repository.open('meetingAudio', fileId, file => file.metadata?.meetingId === String(meetingId))
}
