import {
  buildMeetingDetailsUpdate,
  MeetingUpdateValidationError,
} from '@/lib/meetings/meetingUpdate'

const meeting = {
  type: 'online',
  status: 'scheduled',
  scheduledStart: new Date('2026-09-05T04:30:00.000Z'),
  scheduledEnd: new Date('2026-09-05T05:30:00.000Z'),
}

describe('meeting detail updates', () => {
  test('normalizes schedule edits and keeps legacy timing fields in sync', () => {
    const update = buildMeetingDetailsUpdate({
      title: '  Weekly review  ',
      scheduledStart: '2026-09-06T10:00',
      scheduledEnd: '2026-09-06T11:30',
      priority: 'high',
    }, meeting, { now: new Date('2026-09-03T00:00:00.000Z') })

    expect(update.title).toBe('Weekly review')
    expect(update.duration).toBe(90)
    expect(update.startTime).toEqual(update.scheduledStart)
    expect(update.endTime).toEqual(update.scheduledEnd)
    expect(update.scheduledStart.toISOString()).toBe('2026-09-06T04:30:00.000Z')
  })

  test.each([
    [{ title: '   ' }, 'Meeting title is required'],
    [{ priority: 'critical' }, 'Invalid meeting priority'],
    [{ scheduledStart: 'bad-date' }, 'Invalid meeting date or time'],
    [{ scheduledStart: '2026-09-06T11:30', scheduledEnd: '2026-09-06T10:00' }, 'Meeting end time must be after'],
    [{ scheduledStart: '2026-09-01T10:00', scheduledEnd: '2026-09-01T11:00' }, 'cannot be moved into the past'],
  ])('rejects invalid edit %#', (payload, message) => {
    expect(() => buildMeetingDetailsUpdate(payload, meeting, {
      now: new Date('2026-09-03T00:00:00.000Z'),
    })).toThrow(message)
  })

  test('prevents rescheduling a completed meeting', () => {
    expect(() => buildMeetingDetailsUpdate({
      scheduledStart: '2026-09-06T10:00',
      scheduledEnd: '2026-09-06T11:00',
    }, { ...meeting, status: 'completed' })).toThrow(MeetingUpdateValidationError)
  })
})
