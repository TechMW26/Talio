import { getMeetingParticipantCount } from './livekit.server'

export const EMPTY_ROOM_GRACE_MS = 10 * 60 * 1000

// Never interpret a media-service outage as an empty room. Callers either retain
// the previous state (background refresh) or return a retryable join error.
export async function refreshMeetingAvailability(Meeting, meeting, databaseName, now = new Date()) {
  if (meeting.type !== 'online' || !meeting.roomId || meeting.isLinkActive === false || ['completed', 'cancelled'].includes(meeting.status)) return meeting
  const count = await getMeetingParticipantCount(databaseName, meeting.roomId)
  if (!Number.isFinite(count) || count < 0) throw new Error('Invalid participant count')
  const afterEnd = now >= new Date(meeting.scheduledEnd)
  const emptySince = meeting.roomEmptySince ? new Date(meeting.roomEmptySince) : null
  const updates = { roomParticipantCount: count, roomPresenceCheckedAt: now }
  if (count > 0) {
    Object.assign(updates, { status: 'in-progress', roomEmptySince: null, continuing: afterEnd })
  } else {
    updates.continuing = false
    // Unstarted meetings retain the scheduled window. A previously occupied
    // room gets its grace period immediately, even if everyone leaves early.
    if (!emptySince && (meeting.status === 'in-progress' || afterEnd)) updates.roomEmptySince = now
    if (emptySince && now - emptySince >= EMPTY_ROOM_GRACE_MS) {
      Object.assign(updates, { status: 'completed', isLinkActive: false, actualEnd: emptySince })
    }
  }
  const filter = { _id: meeting._id, status: meeting.status, isLinkActive: { $ne: false }, roomEmptySince: meeting.roomEmptySince || null, roomPresenceCheckedAt: meeting.roomPresenceCheckedAt || null }
  const result = await Meeting.updateOne(filter, { $set: updates }, { timestamps: false })
  if (result.matchedCount === 0) return await Meeting.findById(meeting._id).lean() || meeting
  return { ...(meeting.toObject ? meeting.toObject() : meeting), ...updates }
}
