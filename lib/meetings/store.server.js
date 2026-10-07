import { randomBytes } from 'node:crypto'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { collectFirestorePages, readFirestoreReferences, readFirestorePreview } from '@/lib/platform/firestoreQueries.server'
import { generateRecurringStarts } from '@/lib/meetingRecurrence'
import { buildMeetingReminders, buildMeetingDetailsUpdate } from './meetingUpdate'
import { parseDateTimeInTimezone, getStartOfDayInTimezone, getEndOfDayInTimezone, IST_TIMEZONE } from '@/lib/timezone'

export const MEETING_STORE_OPTIONS = { queryFields: {
  meetings: ['organizer', 'inviteeEmployeeIds', 'type', 'status', 'roomId', 'scheduledStart', 'scheduledEnd', 'isLinkActive', 'guestAccess.guestLink', 'aiSummary.generatedAt', 'needsMeetingInsights', 'updatedAt'],
  employees: ['userId', 'status', 'department', 'departments', 'searchGrams'], users: ['employeeId'], departments: ['isActive'],
  actionablenotifications: ['user', 'reference.model', 'reference.id', 'status'],
} }
export const meetingId = value => String(value?._id || value || '')
export const meetingError = (message, status = 400) => Object.assign(new Error(message), { status })
export const meetingFilter = (field, value, operator = '==') => ({ field, operator, value })
export const getMeetingDatabase = databaseName => getFirestoreTenantDatabase(databaseName, MEETING_STORE_OPTIONS)
export function meetingAccess(meeting, employee) {
  const id = meetingId(employee)
  const isOrganizer = Boolean(id && meetingId(meeting.organizer) === id)
  const invitation = id ? (meeting.invitees || []).find(invite => meetingId(invite.employee) === id) : null
  return { isOrganizer, invitation, allowed: isOrganizer || Boolean(invitation) }
}
export async function requireMeeting(database, id, employee, organizerOnly = false) {
  const meeting = await database.get('meetings', id)
  if (!meeting) throw meetingError('Meeting not found', 404)
  const access = meetingAccess(meeting, employee)
  if (!access.allowed || (organizerOnly && !access.isOrganizer)) throw meetingError(organizerOnly ? 'Only the organizer can update this meeting' : 'You do not have access to this meeting', 403)
  return meeting
}
export async function populateMeeting(database, meeting) {
  const ids = [meeting.organizer, ...(meeting.invitees || []).map(row => row.employee), ...(meeting.agenda || []).map(row => row.presenter), ...(meeting.attachments || []).map(row => row.uploadedBy), ...(meeting.transcript || []).map(row => row.speaker), ...(meeting.aiParticipantNotes || []).map(row => row.employee), ...(meeting.mom?.actionItems || []).map(row => row.assignedTo)]
  const [employees, departments] = await Promise.all([readFirestoreReferences(database, 'employees', ids.map(meetingId)), readFirestoreReferences(database, 'departments', (meeting.invitedDepartments || []).map(meetingId))])
  const employee = id => { const value = employees.get(meetingId(id)); return value ? Object.fromEntries(['_id', 'firstName', 'lastName', 'email', 'profilePicture', 'department', 'userId'].map(key => [key, value[key]])) : null }
  return { ...meeting, organizer: employee(meeting.organizer), invitees: (meeting.invitees || []).map(row => ({ ...row, employee: employee(row.employee) })), invitedDepartments: (meeting.invitedDepartments || []).map(id => departments.get(meetingId(id))).filter(Boolean),
    agenda: (meeting.agenda || []).map(row => ({ ...row, presenter: employee(row.presenter) })), attachments: (meeting.attachments || []).map(row => ({ ...row, uploadedBy: employee(row.uploadedBy) })),
    transcript: (meeting.transcript || []).map(row => ({ ...row, speaker: employee(row.speaker) })), aiParticipantNotes: (meeting.aiParticipantNotes || []).map(row => ({ ...row, employee: employee(row.employee) })),
    ...(meeting.mom?.actionItems ? { mom: { ...meeting.mom, actionItems: meeting.mom.actionItems.map(row => ({ ...row, assignedTo: employee(row.assignedTo) })) } } : {}),
  }
}
export async function listMeetings(database, employee, params) {
  // Small personal reminder feed: no history scan or room-provider requests.
  if (params.get('view') === 'upcoming') {
    const limit = Math.min(5, Math.max(1, Number(params.get('limit')) || 3))
    const filters = [meetingFilter('scheduledStart', new Date(), '>=')]
    const scopes = [meetingFilter('organizer', employee._id), meetingFilter('inviteeEmployeeIds', employee._id, 'array-contains')]
    const visible = row => { const access = meetingAccess(row, employee); return ['scheduled', 'in-progress'].includes(row.status) && access.allowed && (access.isOrganizer || !['rejected', 'declined'].includes(access.invitation?.status)) }
    const rows = (await Promise.all(scopes.map(scope => readFirestorePreview(database, 'meetings', { filters: [...filters, scope], orderBy: [{ field: 'scheduledStart', direction: 'asc' }] }, visible, limit)))).flat()
    return { records: [...new Map(rows.map(row => [row._id, row])).values()].sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart) || String(a._id).localeCompare(String(b._id))).slice(0, limit), pagination: null }
  }
  const filters = [], view = params.get('view'), roomId = params.get('roomId')?.trim().slice(0, 160)
  for (const key of ['status', 'type']) if (params.get(key) && params.get(key) !== 'all') filters.push(meetingFilter(key, params.get(key)))
  if (roomId) filters.push(meetingFilter('roomId', roomId))
  if (params.get('startDate')) filters.push(meetingFilter('scheduledStart', getStartOfDayInTimezone(params.get('startDate'), IST_TIMEZONE), '>='))
  if (params.get('endDate')) filters.push(meetingFilter('scheduledStart', getEndOfDayInTimezone(params.get('endDate'), IST_TIMEZONE), '<='))
  const scopes = view === 'my-meetings' && !roomId ? [meetingFilter('organizer', employee._id)] : view === 'invited' && !roomId ? [meetingFilter('inviteeEmployeeIds', employee._id, 'array-contains')] : [meetingFilter('organizer', employee._id), meetingFilter('inviteeEmployeeIds', employee._id, 'array-contains')]
  const rows = (await Promise.all(scopes.map(scope => collectFirestorePages(database, 'meetings', { filters: [...filters, scope], orderBy: [{ field: 'scheduledStart', direction: 'desc' }] })))).flat()
  const records = [...new Map(rows.map(row => [row._id, row])).values()].sort((a, b) => new Date(b.scheduledStart) - new Date(a.scheduledStart) || String(a._id).localeCompare(String(b._id)))
  const page = Math.max(1, Number(params.get('page')) || 1), limit = Math.min(100, Math.max(1, Number(params.get('limit')) || 20))
  return { records: records.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: records.length, pages: Math.ceil(records.length / limit) } }
}
export async function createMeetingSeries(database, data, organizer) {
  if (!data.title?.trim() || !['online', 'offline'].includes(data.type)) throw meetingError('Title and valid meeting type are required')
  const start = parseDateTimeInTimezone(data.scheduledStart, IST_TIMEZONE)
  let end = parseDateTimeInTimezone(data.scheduledEnd, IST_TIMEZONE)
  if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw meetingError('Invalid meeting date')
  if (end <= start) end = new Date(start.getTime() + 3600000)
  if (data.type === 'offline' && !data.location?.trim()) throw meetingError('Location is required for offline meetings')
  const starts = data.isRecurring ? generateRecurringStarts(start, data.recurrence) : [start]
  if (!starts.length || starts.length > 45) throw meetingError('Choose a recurrence range with 1 to 45 occurrences')
  const invitees = new Set((data.inviteeIds || []).map(meetingId)), departments = [...new Set((data.departmentIds || []).map(meetingId))]
  for (let i = 0; i < departments.length; i += 25) {
    const ids = departments.slice(i, i + 25)
    for (const filter of [meetingFilter('department', ids, 'in'), meetingFilter('departments', ids, 'array-contains-any')]) {
      const employees = await collectFirestorePages(database, 'employees', { filters: [filter, meetingFilter('status', 'active')] })
      employees.forEach(employee => invitees.add(employee._id))
    }
  }
  invitees.delete(meetingId(organizer))
  if (invitees.size > 500) throw meetingError('A meeting supports up to 500 invitees')
  const employeeRecords = await readFirestoreReferences(database, 'employees', [...invitees])
  if (employeeRecords.size !== invitees.size) throw meetingError('An invited employee does not exist')
  if ((await readFirestoreReferences(database, 'departments', departments)).size !== departments.length) throw meetingError('An invited department does not exist')
  const now = new Date(), seriesId = randomBytes(12).toString('hex'), duration = Math.round((end - start) / 60000)
  const meetings = starts.map((time, index) => ({
    _id: index ? randomBytes(12).toString('hex') : seriesId, title: data.title.trim(), description: data.description || '', type: data.type,
    startTime: time, endTime: new Date(time.getTime() + duration * 60000), scheduledStart: time, scheduledEnd: new Date(time.getTime() + duration * 60000), duration,
    location: data.location || '', isOnline: data.type === 'online', roomId: data.type === 'online' ? randomBytes(12).toString('hex') : null,
    organizer: organizer._id, invitees: [...invitees].map(employee => ({ employee, status: 'pending', notificationSent: false, emailSent: false, pushSent: false })), invitedDepartments: departments,
    status: 'scheduled', isLinkActive: true, priority: data.priority || 'medium', agenda: data.agenda || [], tags: data.tags || [],
    isRecurring: Boolean(data.isRecurring), ...(data.isRecurring ? { recurrence: { ...data.recurrence, seriesId, occurrenceIndex: index + 1, ...(index ? { parentMeeting: seriesId } : {}) } } : {}),
    reminders: buildMeetingReminders(data.reminders, time), createdAt: now, updatedAt: now,
  }))
  await database.transaction(async tx => { for (const meeting of meetings) await tx.create('meetings', meeting) })
  return meetings
}
export async function updateMeeting(database, id, employee, data) {
  return database.transaction(async tx => {
    const meeting = await requireMeeting(tx, id, employee, true)
    const next = { ...meeting, ...buildMeetingDetailsUpdate(data, meeting), updatedAt: new Date() }
    for (const key of ['agenda', 'tags', 'notes', 'status', 'actualStart', 'actualEnd']) if (data[key] !== undefined) next[key] = ['actualStart', 'actualEnd'].includes(key) ? parseDateTimeInTimezone(data[key], IST_TIMEZONE) : data[key]
    if (!['scheduled', 'in-progress', 'completed', 'cancelled'].includes(next.status)) throw meetingError('Invalid meeting status')
    const invitees = [...(meeting.invitees || [])]
    for (const id of [...new Set((data.addInvitees || []).map(meetingId))]) {
      if (id === employee._id || invitees.some(invite => meetingId(invite.employee) === id)) continue
      if (!await tx.get('employees', id)) throw meetingError('Invited employee not found', 404)
      invitees.push({ employee: id, status: next.status === 'in-progress' ? 'accepted' : 'pending', ...(next.status === 'in-progress' ? { respondedAt: new Date() } : {}), notificationSent: false, emailSent: false, pushSent: false })
    }
    if (invitees.length > 500) throw meetingError('A meeting supports up to 500 invitees')
    next.invitees = invitees.filter(invite => !(data.removeInvitees || []).includes(meetingId(invite.employee)))
    await tx.replace('meetings', next)
    return next
  })
}
export async function respondToMeeting(database, id, employee, userId, response, reason) {
  const status = response === 'declined' ? 'rejected' : response === 'tentative' ? 'maybe' : response
  if (!['accepted', 'rejected', 'maybe'].includes(status)) throw meetingError('Invalid meeting invitation response')
  return database.transaction(async tx => {
    const meeting = await requireMeeting(tx, id, employee)
    if (!(meeting.invitees || []).some(row => meetingId(row.employee) === employee._id)) throw meetingError('You are not invited to this meeting', 403)
    const notifications = (await tx.list('actionablenotifications', { filters: [meetingFilter('user', userId), meetingFilter('reference.model', 'Meeting'), meetingFilter('reference.id', id), meetingFilter('status', 'pending')], limit: 40, requireComplete: true })).records
    const now = new Date(), next = { ...meeting, updatedAt: now, invitees: meeting.invitees.map(row => meetingId(row.employee) === employee._id ? { ...row, status, respondedAt: now, ...(status === 'rejected' && reason ? { rejectionReason: reason } : {}) } : row) }
    await tx.replace('meetings', next)
    for (const notification of notifications) await tx.replace('actionablenotifications', { ...notification, status: 'actioned', actionTaken: status, actionedAt: now, updatedAt: now })
    return next
  })
}
