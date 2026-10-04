import { sendPushToUser } from '@/lib/pushNotification'
import { sendMeetingInviteEmail, sendMeetingResponseEmail } from '@/lib/mailer'
import { createMeetingInvitationNotification } from '@/lib/actionableNotifications'
import { readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { meetingId } from './store.server'

async function once(database, key, operation) {
  const claimed = await database.transaction(async tx => {
    if (await tx.get('meetingdeliveries', key)) return false
    await tx.create('meetingdeliveries', { _id: key, status: 'sending', createdAt: new Date() })
    return true
  })
  if (!claimed) return
  try {
    await operation()
    await database.mutate('meetingdeliveries', key, record => ({ ...record, status: 'sent', updatedAt: new Date() }))
  } catch (error) {
    await database.mutate('meetingdeliveries', key, record => ({ ...record, status: 'unknown', updatedAt: new Date() })).catch(() => {})
    console.error('[Meeting delivery]', error.message)
  }
}
export async function deliverMeetingInvitations(database, meetings, organizer) {
  const ids = [...new Set(meetings.flatMap(meeting => meeting.invitees.map(invite => meetingId(invite.employee))))]
  const employees = await readFirestoreReferences(database, 'employees', ids)
  const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  for (const meeting of meetings) for (const employee of [organizer, ...employees.values()]) {
    const isOrganizer = employee._id === meetingId(organizer)
    if (!isOrganizer && !meeting.invitees.some(invite => meetingId(invite.employee) === employee._id)) continue
    if (!isOrganizer && employee.userId) {
      const userId = meetingId(employee.userId)
      await once(database, `${meeting._id}-${userId}-action`, () => createMeetingInvitationNotification(database, { targetUserId: userId, meetingId: meeting._id, meetingTitle: meeting.title, organizerId: organizer._id, organizerName: `${organizer.firstName} ${organizer.lastName}`, startTime: meeting.scheduledStart, endTime: meeting.scheduledEnd, isRecurring: meeting.isRecurring }))
      await once(database, `${meeting._id}-${userId}-push`, () => sendPushToUser(userId, { title: 'Meeting invitation', body: `${organizer.firstName} ${organizer.lastName} invited you to "${meeting.title}"` }, { database, eventType: 'meeting-invite', clickAction: `/dashboard/meetings/${meeting._id}`, data: { meetingId: meeting._id } }))
      global.io?.to(`user:${userId}`).emit('meeting-invite', { meetingId: meeting._id, roomId: meeting.roomId, title: meeting.title })
    }
    if (employee.email) await once(database, `${meeting._id}-${employee._id}-email`, () => sendMeetingInviteEmail({ to: employee.email, inviteeName: `${employee.firstName} ${employee.lastName}`, organizerName: isOrganizer ? 'You' : `${organizer.firstName} ${organizer.lastName}`, meetingTitle: meeting.title, meetingType: meeting.type, startTime: meeting.scheduledStart, endTime: meeting.scheduledEnd, location: meeting.location, description: meeting.description, meetingLink: meeting.type === 'online' ? `${baseUrl}/dashboard/meetings/room/${meeting.roomId}` : null, respondLink: `${baseUrl}/dashboard/meetings/${meeting._id}` }))
  }
}
export async function deliverMeetingChange(database, meeting, type, message) {
  const employees = await readFirestoreReferences(database, 'employees', (meeting.invitees || []).map(invite => meetingId(invite.employee)))
  await Promise.allSettled([...employees.values()].filter(row => row.userId).map(row => sendPushToUser(meetingId(row.userId), { title: `Meeting ${type}`, body: message }, { database, eventType: `meeting-${type}`, clickAction: `/dashboard/meetings`, data: { meetingId: meeting._id } })))
}
export async function deliverMeetingResponse(database, meeting, employee, status, reason) {
  const organizer = await database.get('employees', meetingId(meeting.organizer))
  if (!organizer) return
  if (organizer.userId) await sendPushToUser(meetingId(organizer.userId), { title: 'Meeting response', body: `${employee.firstName} ${employee.lastName}: ${status} "${meeting.title}"` }, { database, eventType: 'meeting-response', clickAction: `/dashboard/meetings/${meeting._id}`, data: { meetingId: meeting._id, response: status } }).catch(() => {})
  if (organizer.email) await sendMeetingResponseEmail({ to: organizer.email, organizerName: `${organizer.firstName} ${organizer.lastName}`, inviteeName: `${employee.firstName} ${employee.lastName}`, meetingTitle: meeting.title, response: status, reason }).catch(() => {})
}
