import { processExpiredMeetingsForDatabase } from '@/lib/meetingFinalizer'
import { getTenantModels } from '@/lib/tenantModels'
import { getMeetingParticipantCount } from '@/lib/meetings/livekit.server'
jest.mock('@/lib/tenantModels', () => ({ getTenantModels: jest.fn() }))
jest.mock('@/lib/meetings/livekit.server', () => ({ getMeetingParticipantCount: jest.fn() }))
jest.mock('@/lib/meetingAI', () => ({ generateMeetingInsights: jest.fn(), hasMeetingInsightSource: jest.fn(), persistMeetingInsights: jest.fn(), sendMeetingMinutesEmails: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitMeetingUpdate: jest.fn() }))
const now = new Date('2026-09-29T12:00:00Z')
let Meeting, meeting
beforeEach(() => {
  jest.clearAllMocks()
  meeting = { _id: 'meeting', type: 'online', roomId: 'room', status: 'in-progress', scheduledEnd: new Date('2026-09-29T11:00:00Z'), isLinkActive: true }
  Meeting = { updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }), updateMany: jest.fn(), find: jest.fn(query => {
    const results = query.status?.$in ? [meeting] : []
    return { select() { return this }, populate() { return this }, lean: async () => results, then: resolve => Promise.resolve(results).then(resolve) }
  }) }
  getTenantModels.mockResolvedValue({ Meeting })
})
test('background expiry does not complete an occupied overdue meeting', async () => {
  getMeetingParticipantCount.mockResolvedValue(2)
  const result = await processExpiredMeetingsForDatabase('tenant', { now })
  expect(result.meetingsCompleted).toBe(0)
  expect(result.linksDeactivated).toBe(0)
  expect(Meeting.updateOne.mock.calls[0][1].$set).toMatchObject({ status: 'in-progress', continuing: true })
})
test('background expiry completes only after the empty grace window', async () => {
  getMeetingParticipantCount.mockResolvedValue(0)
  meeting.roomEmptySince = new Date(now - 600000)
  const result = await processExpiredMeetingsForDatabase('tenant', { now })
  expect(result.meetingsCompleted).toBe(1)
  expect(result.linksDeactivated).toBe(1)
})
test('offline scheduled expiry remains unchanged', async () => {
  meeting.type = 'offline'
  const result = await processExpiredMeetingsForDatabase('tenant', { now })
  expect(result.meetingsCompleted).toBe(1)
  expect(getMeetingParticipantCount).not.toHaveBeenCalled()
})
