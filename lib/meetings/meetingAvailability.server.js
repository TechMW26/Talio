import { getMeetingParticipantCount } from './livekit.server'

export const EMPTY_ROOM_GRACE_MS = 10 * 60 * 1000

// Never interpret a media-service outage as an empty room. Callers either retain
// the previous state (background refresh) or return a retryable join error.
export async function refreshMeetingAvailability(database, meeting, databaseName, now = new Date()) {
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
  return database.mutate('meetings', String(meeting._id), current => {
    if (!current) return null
    const time = value => value ? new Date(value).getTime() : null
    if (current.status !== meeting.status || current.isLinkActive === false || time(current.roomEmptySince) !== time(meeting.roomEmptySince) || time(current.roomPresenceCheckedAt) !== time(meeting.roomPresenceCheckedAt)) return current
    return { ...current, ...updates }
  })
}
