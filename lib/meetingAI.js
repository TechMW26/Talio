import { generateContent } from './gemini.js'
import {
  detectMeetingLanguage,
  formatMeetingTranscriptForPrompt,
  normalizeMeetingLanguage,
  pickMeetingOutputLanguage,
  sortMeetingTranscript,
} from './meetingLanguage.js'

function extractJsonObject(text) {
  const jsonMatch = text?.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Failed to parse meeting AI response as JSON')
  }

  return JSON.parse(jsonMatch[0])
}

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item || '').trim())
    .filter(Boolean)
}

export function hasMeetingInsightSource(meeting) {
  const hasTranscript = (meeting?.transcript || []).some(segment => String(segment?.text || '').trim())
  const hasNotes = Boolean(String(meeting?.notes || '').trim())
  const hasMom = Array.isArray(meeting?.mom) && meeting.mom.length > 0

  return hasTranscript || hasNotes || hasMom
}

export async function resolveMeetingEmployee(models, user) {
  const { Employee, User } = models
  const userId = user?._id || user?.userId

  const userRecord = await User.findById(userId).select('employeeId').lean()

  if (userRecord?.employeeId) {
    const employee = await Employee.findById(userRecord.employeeId).lean()
    if (employee) {
      return employee
    }
  }

  return Employee.findOne({ userId }).lean()
}

function buildParticipantLookup(meeting) {
  const lookup = new Map()

  const organizerId = meeting?.organizer?._id?.toString?.() || meeting?.organizer?.toString?.()
  const organizerName = [meeting?.organizer?.firstName, meeting?.organizer?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()

  if (organizerName) {
    lookup.set(organizerName.toLowerCase(), organizerId || null)
  }

  for (const invitee of meeting?.invitees || []) {
    const employeeId = invitee?.employee?._id?.toString?.() || invitee?.employee?.toString?.()
    const speakerName = [invitee?.employee?.firstName, invitee?.employee?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim()

    if (speakerName) {
      lookup.set(speakerName.toLowerCase(), employeeId || null)
    }
  }

  for (const segment of meeting?.transcript || []) {
    if (!segment?.speakerName) continue
    const key = segment.speakerName.toLowerCase()
    const employeeId = segment?.speaker?._id?.toString?.() || segment?.speaker?.toString?.() || null
    if (!lookup.has(key) || employeeId) {
      lookup.set(key, employeeId)
    }
  }

  return lookup
}

export async function generateMeetingInsights(meeting, options = {}) {
  const transcript = sortMeetingTranscript(meeting?.transcript || [])
  const transcriptText = transcript.map(segment => segment.text || '').join(' ')
  const requestedLanguage = normalizeMeetingLanguage(options.language || 'auto')
  const outputLanguage = requestedLanguage === 'auto'
    ? pickMeetingOutputLanguage(meeting?.transcriptLanguages, transcriptText, detectMeetingLanguage(transcriptText, 'en'))
    : requestedLanguage

  const participants = [
    meeting?.organizer
      ? `${meeting.organizer.firstName || ''} ${meeting.organizer.lastName || ''}`.trim()
      : null,
    ...(meeting?.invitees || []).map(invitee => (
      `${invitee?.employee?.firstName || ''} ${invitee?.employee?.lastName || ''}`.trim()
    )),
  ].filter(Boolean)

  const languageInstruction = outputLanguage === 'hi'
    ? 'Respond entirely in Hindi using Devanagari script.'
    : outputLanguage === 'hinglish'
      ? 'Respond in Hinglish using natural Roman-script Hindi mixed with English.'
      : outputLanguage === 'en'
        ? 'Respond entirely in English.'
        : `Respond entirely in ${outputLanguage}.`

  const prompt = `${languageInstruction}

Return only valid JSON with this exact shape:
{
  "language": "${outputLanguage}",
  "summary": "2-3 paragraph meeting summary",
  "keyPoints": ["point"],
  "actionItems": ["Owner - action item"],
  "decisions": ["decision"],
  "nextSteps": ["next step"],
  "participantNotes": [
    {
      "speakerName": "participant name",
      "summary": "summary of this participant's contribution",
      "keyContributions": ["contribution"],
      "actionItems": ["participant action item"],
      "followUps": ["follow up" ]
    }
  ]
}

Rules:
- Be factual and grounded only in the supplied meeting material.
- Preserve participant names exactly as provided.
- Do not invent owners, deadlines, or decisions.
- Omit participantNotes entries for people with no meaningful contribution.
- Keep arrays concise and specific.

Meeting title: ${meeting?.title || 'Untitled meeting'}
Meeting type: ${meeting?.type || 'online'}
Scheduled start: ${meeting?.scheduledStart || ''}
Scheduled end: ${meeting?.scheduledEnd || ''}
Description: ${meeting?.description || 'N/A'}
Agenda:
${(meeting?.agenda || []).map((item, index) => `${index + 1}. ${item?.title || 'Agenda item'} (${item?.duration || 0} min)`).join('\n') || 'No formal agenda'}

Participants:
${participants.join('\n') || 'No participants recorded'}

Meeting notes:
${meeting?.notes || 'No manual notes'}

Transcript:
${formatMeetingTranscriptForPrompt(transcript)}
`

  const response = await generateContent(
    prompt,
    'You are Talio meeting intelligence. Return valid JSON only, with no markdown fences or explanations.'
  )

  const parsed = extractJsonObject(response)

  return {
    language: normalizeMeetingLanguage(parsed.language || outputLanguage),
    summary: String(parsed.summary || '').trim(),
    keyPoints: sanitizeStringArray(parsed.keyPoints),
    actionItems: sanitizeStringArray(parsed.actionItems),
    decisions: sanitizeStringArray(parsed.decisions),
    nextSteps: sanitizeStringArray(parsed.nextSteps),
    participantNotes: Array.isArray(parsed.participantNotes)
      ? parsed.participantNotes
          .map(note => ({
            speakerName: String(note?.speakerName || '').trim(),
            summary: String(note?.summary || '').trim(),
            keyContributions: sanitizeStringArray(note?.keyContributions),
            actionItems: sanitizeStringArray(note?.actionItems),
            followUps: sanitizeStringArray(note?.followUps),
          }))
          .filter(note => note.speakerName && note.summary)
      : [],
  }
}

export function mapParticipantNotesToMeeting(meeting, participantNotes = [], language = 'en') {
  const participantLookup = buildParticipantLookup(meeting)

  return participantNotes.map(note => ({
    employee: participantLookup.get(note.speakerName.toLowerCase()) || undefined,
    speakerName: note.speakerName,
    summary: note.summary,
    keyContributions: note.keyContributions,
    actionItems: note.actionItems,
    followUps: note.followUps,
    language: normalizeMeetingLanguage(language),
    generatedAt: new Date(),
  }))
}

export function buildMeetingInsightUpdate(meeting, insights, options = {}) {
  const generatedAt = options.generatedAt ? new Date(options.generatedAt) : new Date()
  const sourceUpdatedAt = options.sourceUpdatedAt
    ? new Date(options.sourceUpdatedAt)
    : new Date(meeting?.updatedAt || generatedAt)
  const language = normalizeMeetingLanguage(insights?.language || 'en')

  return {
    aiSummary: {
      summary: String(insights?.summary || '').trim(),
      keyPoints: sanitizeStringArray(insights?.keyPoints),
      actionItems: sanitizeStringArray(insights?.actionItems),
      decisions: sanitizeStringArray(insights?.decisions),
      nextSteps: sanitizeStringArray(insights?.nextSteps),
      generatedAt,
      language,
      sourceUpdatedAt,
    },
    aiParticipantNotes: mapParticipantNotesToMeeting(
      meeting,
      insights?.participantNotes,
      language
    ),
  }
}

export async function persistMeetingInsights(MeetingModel, meeting, insights, options = {}) {
  const update = buildMeetingInsightUpdate(meeting, insights, options)

  await MeetingModel.updateOne(
    { _id: meeting._id },
    { $set: update },
    { timestamps: false }
  )

  return update
}
