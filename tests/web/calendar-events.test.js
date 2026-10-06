import { buildCalendarEvents, calendarDateKey } from '@/lib/client/calendarEvents'

test('date-only deadlines stay unchanged and timestamps use company timezone', () => {
  expect(calendarDateKey('2026-10-06')).toBe('2026-10-06')
  expect(calendarDateKey('2026-10-05T21:00:00Z')).toBe('2026-10-06')
  expect(calendarDateKey('bad-date')).toBe('')
})

test('calendar combines actual tasks, holidays, celebrations and announcements', () => {
  const events = buildCalendarEvents({
    tasks: [{ _id: 't', title: 'Deliver', dueDate: '2026-10-06', project: { _id: 'p' } }],
    holidays: [{ _id: 'h', name: 'Holiday', date: '2026-10-07' }],
    birthdays: [{ _id: 'b', firstName: 'Test', dateOfBirth: '1990-10-08' }],
    announcements: [{ _id: 'a', title: 'Celebration', eventDate: '2026-10-09', createdAt: '2026-10-01' }],
  }, 2026)
  expect(events[0]).toMatchObject({ type: 'task', date: '2026-10-06', href: '/dashboard/projects/p' })
  expect(events.find(e => e.type === 'announcement').date).toBe('2026-10-09')
  expect(events.filter(e => e.type === 'birthday').map(e => e.date)).toEqual(['2026-10-08', '2027-10-08'])
})

test('invalid dates and leap birthdays do not leak into the wrong day', () => {
  const events = buildCalendarEvents({ tasks: [{ title: 'No date' }], birthdays: [{ firstName: 'Leap', dateOfBirth: '2000-02-29' }] }, 2026)
  expect(events).toEqual([])
})
