import { workflowStore } from '../helpers/firestoreWorkflowStore'
import { processExpiredMeetingsForDatabase } from '@/lib/meetingFinalizer'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getMeetingParticipantCount } from '@/lib/meetings/livekit.server'
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/meetings/livekit.server', () => ({ getMeetingParticipantCount: jest.fn() }))
jest.mock('@/lib/meetingAI', () => ({ generateMeetingInsights: jest.fn(), hasMeetingInsightSource: jest.fn(), persistMeetingInsights: jest.fn(), sendMeetingMinutesEmails: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitMeetingUpdate: jest.fn() }))
const now = new Date('2026-09-29T12:00:00Z')
let database, meeting
beforeEach(() => {
  jest.clearAllMocks()
  meeting = { _id: 'meeting', type: 'online', roomId: 'room', status: 'in-progress', scheduledEnd: new Date('2026-09-29T11:00:00Z'), isLinkActive: true }
})
const seed = () => { database = workflowStore({ meetings: [meeting] }); getFirestoreTenantDatabase.mockResolvedValue(database) }
test('background expiry does not complete occupied meeting', async () => {
  seed(); getMeetingParticipantCount.mockResolvedValue(2)
  const result = await processExpiredMeetingsForDatabase('talio_company_test', { now })
  expect(result.meetingsCompleted).toBe(0)
  expect((await database.get('meetings', 'meeting')).continuing).toBe(true)
})
test('empty room closes only after grace window', async () => {
  meeting.roomEmptySince = new Date(now - 600000); seed(); getMeetingParticipantCount.mockResolvedValue(0)
  const result = await processExpiredMeetingsForDatabase('talio_company_test', { now })
  expect(result.meetingsCompleted).toBe(1)
  expect((await database.get('meetings', 'meeting')).isLinkActive).toBe(false)
})
test('offline expiry is preserved', async () => {
  meeting.type = 'offline'; seed()
  const result = await processExpiredMeetingsForDatabase('talio_company_test', { now })
  expect(result.meetingsCompleted).toBe(1)
  expect(getMeetingParticipantCount).not.toHaveBeenCalled()
})
