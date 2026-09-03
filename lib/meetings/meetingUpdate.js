import { IST_TIMEZONE, parseDateTimeInTimezone } from '@/lib/timezone'

const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent'])

export class MeetingUpdateValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MeetingUpdateValidationError'
  }
}

function boundedText(value, label, maxLength, { required = false } = {}) {
  const text = String(value ?? '').trim()
  if (required && !text) throw new MeetingUpdateValidationError(`${label} is required`)
  if (text.length > maxLength) {
    throw new MeetingUpdateValidationError(`${label} must be ${maxLength} characters or fewer`)
  }
  return text
}

export function buildMeetingDetailsUpdate(data, meeting, {
  timezone = IST_TIMEZONE,
  now = new Date(),
} = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new MeetingUpdateValidationError('Invalid meeting update')
  }

  const update = {}
  if (data.title !== undefined) update.title = boundedText(data.title, 'Meeting title', 200, { required: true })
  if (data.description !== undefined) update.description = boundedText(data.description, 'Description', 4000)
  if (data.location !== undefined) update.location = boundedText(data.location, 'Location', 500)
  if (data.priority !== undefined) {
    if (!PRIORITIES.has(data.priority)) throw new MeetingUpdateValidationError('Invalid meeting priority')
    update.priority = data.priority
  }

  const scheduleChanged = data.scheduledStart !== undefined || data.scheduledEnd !== undefined
  if (!scheduleChanged) return update
  if (['completed', 'cancelled'].includes(meeting.status)) {
    throw new MeetingUpdateValidationError('Completed or cancelled meetings cannot be rescheduled')
  }

  const scheduledStart = parseDateTimeInTimezone(
    data.scheduledStart !== undefined ? data.scheduledStart : meeting.scheduledStart,
    timezone,
  )
  const scheduledEnd = parseDateTimeInTimezone(
    data.scheduledEnd !== undefined ? data.scheduledEnd : meeting.scheduledEnd,
    timezone,
  )
  if (!scheduledStart || !scheduledEnd) {
    throw new MeetingUpdateValidationError('Invalid meeting date or time')
  }
  if (scheduledEnd <= scheduledStart) {
    throw new MeetingUpdateValidationError('Meeting end time must be after the start time')
  }

  const duration = Math.round((scheduledEnd.getTime() - scheduledStart.getTime()) / 60000)
  if (duration < 5 || duration > 1440) {
    throw new MeetingUpdateValidationError('Meeting duration must be between 5 minutes and 24 hours')
  }
  if (data.scheduledStart !== undefined && scheduledStart < now) {
    throw new MeetingUpdateValidationError('Meeting start time cannot be moved into the past')
  }
  if (meeting.type === 'offline' && data.location !== undefined && !update.location) {
    throw new MeetingUpdateValidationError('Location is required for an offline meeting')
  }

  return {
    ...update,
    scheduledStart,
    scheduledEnd,
    startTime: scheduledStart,
    endTime: scheduledEnd,
    duration,
  }
}
