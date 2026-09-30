import { generateMeetingInsights } from '@/lib/meetingAI'
import { generateContent } from '@/lib/gemini'
jest.mock('@/lib/gemini', () => ({ generateContent: jest.fn() }))
jest.mock('@/lib/mailer', () => ({ sendMeetingMOMEmail: jest.fn() }))
const english = JSON.stringify({ language: 'en', summary: 'The participants tested the meeting interface. No decisions were recorded.', keyPoints: [], participantNotes: [] })
beforeEach(() => jest.clearAllMocks())

test('mixed-language transcripts produce professional English instructions, even with a legacy language option', async () => {
  generateContent.mockResolvedValue(english)
  const meeting = { transcriptLanguages: ['hin', 'por'], transcript: [{ text: 'नमस्ते', speakerName: 'Asha', language: 'hin' }] }
  const result = await generateMeetingInsights(meeting, { language: 'por' })
  expect(result.language).toBe('en')
  expect(generateContent.mock.calls[0][0]).toContain('professional English')
  expect(generateContent.mock.calls[0][0]).toContain('नमस्ते')
  expect(generateContent.mock.calls[0][1]).toContain('All narrative JSON fields must be in English')
  expect(meeting.transcript[0].text).toBe('नमस्ते')
})

test('retries a non-English model response once', async () => {
  generateContent.mockResolvedValueOnce(JSON.stringify({ language: 'pt', summary: 'A reunião' })).mockResolvedValueOnce(english)
  expect((await generateMeetingInsights({})).language).toBe('en')
  expect(generateContent).toHaveBeenCalledTimes(2)
})

test('does not save a known non-English response as English after failed retry', async () => {
  generateContent.mockResolvedValue(JSON.stringify({ language: 'pt', summary: 'A reunião' }))
  await expect(generateMeetingInsights({})).rejects.toThrow('not generated in English')
  expect(generateContent).toHaveBeenCalledTimes(2)
})
