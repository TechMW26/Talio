import { generateContent } from './gemini.js'
import {
  detectMeetingLanguage,
  formatMeetingTranscriptForPrompt,
  normalizeMeetingLanguage,
  pickMeetingOutputLanguage,
  sortMeetingTranscript,
} from './meetingLanguage.js'
import { sendMeetingMOMEmail } from './mailer.js'
import { resolveMeetingEmployee } from './meetingParticipants.js'

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

function toOptionalDate(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatSummaryDateTime(value) {
  const parsed = toOptionalDate(value)
  if (!parsed) return null

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildMeetingSummarySessionTag(sessionNumber, sessionStartedAt, sessionEndedAt, generatedAt) {
  const startedLabel = formatSummaryDateTime(sessionStartedAt)
  const endedLabel = formatSummaryDateTime(sessionEndedAt)
  const generatedLabel = formatSummaryDateTime(generatedAt)

  if (startedLabel && endedLabel) {
    return `Session ${sessionNumber} • ${startedLabel} to ${endedLabel}`
  }

  if (startedLabel) {
    return `Session ${sessionNumber} • Started ${startedLabel}`
  }

  if (generatedLabel) {
    return `Session ${sessionNumber} • Generated ${generatedLabel}`
  }

  return `Session ${sessionNumber}`
}

function normalizeSummaryHistoryEntry(entry = {}, fallbackSessionNumber = 1) {
  const generatedAt = toOptionalDate(entry.generatedAt) || new Date()
  const sourceUpdatedAt = toOptionalDate(entry.sourceUpdatedAt) || generatedAt
  const sessionNumber = Number(entry.sessionNumber) || fallbackSessionNumber
  const sessionStartedAt = toOptionalDate(entry.sessionStartedAt)
  const sessionEndedAt = toOptionalDate(entry.sessionEndedAt)

  return {
    summary: String(entry.summary || '').trim(),
    keyPoints: sanitizeStringArray(entry.keyPoints),
    actionItems: sanitizeStringArray(entry.actionItems),
    decisions: sanitizeStringArray(entry.decisions),
    nextSteps: sanitizeStringArray(entry.nextSteps),
    generatedAt,
    sourceUpdatedAt,
    language: normalizeMeetingLanguage(entry.language || 'en'),
    sessionNumber,
    sessionStartedAt,
    sessionEndedAt,
    sessionTag: String(entry.sessionTag || '').trim()
      || buildMeetingSummarySessionTag(sessionNumber, sessionStartedAt, sessionEndedAt, generatedAt),
  }
}

function normalizeParticipantNoteEntry(entry = {}, fallbackSessionNumber = 1, fallbackSessionTag = '') {
  const generatedAt = toOptionalDate(entry.generatedAt) || new Date()
  const sessionNumber = Number(entry.sessionNumber) || fallbackSessionNumber
  const sessionStartedAt = toOptionalDate(entry.sessionStartedAt)
  const sessionEndedAt = toOptionalDate(entry.sessionEndedAt)

  return {
    employee: entry.employee,
    speakerName: String(entry.speakerName || '').trim(),
    summary: String(entry.summary || '').trim(),
    keyContributions: sanitizeStringArray(entry.keyContributions),
    actionItems: sanitizeStringArray(entry.actionItems),
    followUps: sanitizeStringArray(entry.followUps),
    generatedAt,
    language: normalizeMeetingLanguage(entry.language || 'en'),
    sessionNumber,
    sessionStartedAt,
    sessionEndedAt,
    sessionTag: String(entry.sessionTag || '').trim()
      || fallbackSessionTag
      || buildMeetingSummarySessionTag(sessionNumber, sessionStartedAt, sessionEndedAt, generatedAt),
  }
}

function getExistingSummaryHistory(meeting) {
  return Array.isArray(meeting?.aiSummary?.history)
    ? meeting.aiSummary.history.map((entry, index) => normalizeSummaryHistoryEntry(entry, index + 1))
    : []
}

function getLatestSummarySession(existingHistory = [], meeting = null) {
  if (existingHistory.length > 0) {
    return existingHistory[existingHistory.length - 1]
  }

  if (meeting?.aiSummary?.summary) {
    return normalizeSummaryHistoryEntry(meeting.aiSummary, Number(meeting?.aiSummary?.sessionNumber) || 1)
  }

  return null
}

function normalizeExistingParticipantNotes(meeting, existingHistory = []) {
  const latestSummarySession = getLatestSummarySession(existingHistory, meeting)
  const fallbackSessionNumber = latestSummarySession?.sessionNumber || 1
  const fallbackSessionTag = latestSummarySession?.sessionTag || ''
  const historyBySession = new Map(existingHistory.map(entry => [entry.sessionNumber, entry]))

  return Array.isArray(meeting?.aiParticipantNotes)
    ? meeting.aiParticipantNotes
        .map(note => {
          const sessionNumber = Number(note?.sessionNumber) || fallbackSessionNumber
          const matchedSession = historyBySession.get(sessionNumber)

          return normalizeParticipantNoteEntry(
            note,
            sessionNumber,
            matchedSession?.sessionTag || fallbackSessionTag
          )
        })
        .filter(note => note.speakerName && note.summary)
    : []
}

export function hasMeetingInsightSource(meeting) {
  const hasTranscript = (meeting?.transcript || []).some(segment => String(segment?.text || '').trim())
  const hasNotes = Boolean(String(meeting?.notes || '').trim())
  const hasMom = Array.isArray(meeting?.mom) && meeting.mom.length > 0

  return hasTranscript || hasNotes || hasMom
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

export function mapParticipantNotesToMeeting(meeting, participantNotes = [], options = {}) {
  const participantLookup = buildParticipantLookup(meeting)
  const generatedAt = toOptionalDate(options.generatedAt) || new Date()
  const language = normalizeMeetingLanguage(options.language || 'en')
  const sessionNumber = Number(options.sessionNumber) || 1
  const sessionStartedAt = toOptionalDate(options.sessionStartedAt)
  const sessionEndedAt = toOptionalDate(options.sessionEndedAt)
  const sessionTag = String(options.sessionTag || '').trim()
    || buildMeetingSummarySessionTag(sessionNumber, sessionStartedAt, sessionEndedAt, generatedAt)

  return participantNotes
    .map(note => normalizeParticipantNoteEntry({
      employee: participantLookup.get(note.speakerName.toLowerCase()) || undefined,
      speakerName: note.speakerName,
      summary: note.summary,
      keyContributions: note.keyContributions,
      actionItems: note.actionItems,
      followUps: note.followUps,
      language,
      generatedAt,
      sessionNumber,
      sessionStartedAt,
      sessionEndedAt,
      sessionTag,
    }, sessionNumber, sessionTag))
    .filter(note => note.speakerName && note.summary)
}

export function buildMeetingInsightUpdate(meeting, insights, options = {}) {
  const generatedAt = options.generatedAt ? new Date(options.generatedAt) : new Date()
  const sourceUpdatedAt = options.sourceUpdatedAt
    ? new Date(options.sourceUpdatedAt)
    : new Date(meeting?.updatedAt || generatedAt)
  const language = normalizeMeetingLanguage(insights?.language || 'en')
  const existingHistory = getExistingSummaryHistory(meeting)
  const latestExistingSummary = getLatestSummarySession(existingHistory, meeting)
  const shouldAppendHistory = options.appendHistory === true
  const shouldReplaceLatestHistory = options.replaceLatestHistory === true
  const nextSessionNumber = Number(options.sessionNumber)
    || (shouldReplaceLatestHistory && latestExistingSummary
      ? latestExistingSummary.sessionNumber
      : existingHistory.length + 1)
  const sessionStartedAt = toOptionalDate(options.sessionStartedAt)
    || (shouldReplaceLatestHistory ? latestExistingSummary?.sessionStartedAt || null : null)
  const sessionEndedAt = toOptionalDate(options.sessionEndedAt)
    || (shouldReplaceLatestHistory ? latestExistingSummary?.sessionEndedAt || null : null)
  const latestSummary = normalizeSummaryHistoryEntry({
    summary: insights?.summary,
    keyPoints: insights?.keyPoints,
    actionItems: insights?.actionItems,
    decisions: insights?.decisions,
    nextSteps: insights?.nextSteps,
    generatedAt,
    sourceUpdatedAt,
    language,
    sessionNumber: nextSessionNumber,
    sessionStartedAt,
    sessionEndedAt,
    sessionTag: options.sessionTag,
  }, nextSessionNumber)
  let history = [latestSummary]

  if (shouldAppendHistory) {
    history = [...existingHistory, latestSummary]
  } else if (shouldReplaceLatestHistory && existingHistory.length > 0) {
    history = [...existingHistory.slice(0, -1), latestSummary]
  }

  const existingParticipantNotes = normalizeExistingParticipantNotes(meeting, existingHistory)
  const latestParticipantNotes = mapParticipantNotesToMeeting(meeting, insights?.participantNotes, {
    language,
    generatedAt,
    sessionNumber: latestSummary.sessionNumber,
    sessionStartedAt: latestSummary.sessionStartedAt,
    sessionEndedAt: latestSummary.sessionEndedAt,
    sessionTag: latestSummary.sessionTag,
  })

  let aiParticipantNotes = latestParticipantNotes

  if (shouldAppendHistory) {
    aiParticipantNotes = [...existingParticipantNotes, ...latestParticipantNotes]
  } else if (shouldReplaceLatestHistory && existingParticipantNotes.length > 0) {
    aiParticipantNotes = [
      ...existingParticipantNotes.filter(note => note.sessionNumber !== latestSummary.sessionNumber),
      ...latestParticipantNotes,
    ]
  }

  return {
    aiSummary: {
      ...latestSummary,
      history,
    },
    aiParticipantNotes,
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

function formatTextSection(title, items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return []
  }

  return [
    `${title}:`,
    ...items.map(item => `- ${item}`),
  ]
}

function getMeetingInsightTimeline(meeting) {
  const summaryHistory = getExistingSummaryHistory(meeting)
  const latestSummarySession = getLatestSummarySession(summaryHistory, meeting)
  const fallbackSessionNumber = latestSummarySession?.sessionNumber || 1
  const participantNotes = normalizeExistingParticipantNotes(meeting, summaryHistory)
  const notesBySession = new Map()

  for (const note of participantNotes) {
    const sessionNumber = Number(note.sessionNumber) || fallbackSessionNumber
    const currentNotes = notesBySession.get(sessionNumber) || []
    currentNotes.push(note)
    notesBySession.set(sessionNumber, currentNotes)
  }

  const sessionNumbers = new Set(summaryHistory.map(entry => entry.sessionNumber))
  for (const sessionNumber of notesBySession.keys()) {
    sessionNumbers.add(sessionNumber)
  }

  return Array.from(sessionNumbers)
    .sort((left, right) => left - right)
    .map((sessionNumber, index) => {
      const summaryEntry = summaryHistory.find(entry => entry.sessionNumber === sessionNumber) || null
      const generatedAt = summaryEntry?.generatedAt
        || notesBySession.get(sessionNumber)?.[0]?.generatedAt
        || null
      const sessionTag = summaryEntry?.sessionTag
        || notesBySession.get(sessionNumber)?.[0]?.sessionTag
        || buildMeetingSummarySessionTag(sessionNumber, null, null, generatedAt)

      return {
        sessionNumber,
        sessionTag,
        generatedAt,
        summary: summaryEntry,
        participantNotes: notesBySession.get(sessionNumber) || [],
        index,
      }
    })
}

function buildMeetingMomText(meeting) {
  const timeline = getMeetingInsightTimeline(meeting)

  if (timeline.length === 0) {
    return ''
  }

  return timeline
    .map(session => {
      const lines = [session.sessionTag]

      if (session.summary?.summary) {
        lines.push('', session.summary.summary)
      }

      lines.push(
        ...formatTextSection('Key Points', session.summary?.keyPoints),
        ...formatTextSection('Action Items', session.summary?.actionItems),
        ...formatTextSection('Decisions', session.summary?.decisions),
        ...formatTextSection('Next Steps', session.summary?.nextSteps),
      )

      if (session.participantNotes.length > 0) {
        lines.push('', 'Participant Notes:')

        for (const note of session.participantNotes) {
          lines.push(`- ${note.speakerName}: ${note.summary}`)

          for (const item of note.keyContributions || []) {
            lines.push(`  Contribution: ${item}`)
          }

          for (const item of note.actionItems || []) {
            lines.push(`  Action Item: ${item}`)
          }

          for (const item of note.followUps || []) {
            lines.push(`  Follow Up: ${item}`)
          }
        }
      }

      return lines.filter(Boolean).join('\n')
    })
    .join('\n\n------------------------------\n\n')
}

function buildLatestAiSummaryText(meeting) {
  const latestSummary = getLatestSummarySession(getExistingSummaryHistory(meeting), meeting)

  if (!latestSummary?.summary) {
    return ''
  }

  return [
    latestSummary.summary,
    ...formatTextSection('Key Points', latestSummary.keyPoints),
    ...formatTextSection('Action Items', latestSummary.actionItems),
    ...formatTextSection('Decisions', latestSummary.decisions),
    ...formatTextSection('Next Steps', latestSummary.nextSteps),
  ].join('\n')
}

function getMeetingMomRecipients(meeting) {
  const recipients = new Map()

  const addRecipient = (email, inviteeName) => {
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!normalizedEmail) {
      return
    }

    if (!recipients.has(normalizedEmail)) {
      recipients.set(normalizedEmail, {
        to: normalizedEmail,
        inviteeName: String(inviteeName || '').trim(),
      })
    }
  }

  addRecipient(
    meeting?.organizer?.email,
    [meeting?.organizer?.firstName, meeting?.organizer?.lastName].filter(Boolean).join(' ')
  )

  for (const invitee of meeting?.invitees || []) {
    addRecipient(
      invitee?.employee?.email,
      [invitee?.employee?.firstName, invitee?.employee?.lastName].filter(Boolean).join(' ')
    )
  }

  return Array.from(recipients.values())
}

function buildMeetingDetailUrl(meetingId, origin) {
  const baseUrl = String(
    origin
    || process.env.NEXT_PUBLIC_APP_URL
    || process.env.APP_URL
    || process.env.NEXTAUTH_URL
    || ''
  ).trim()

  if (!baseUrl) {
    return null
  }

  try {
    return new URL(`/dashboard/meetings/${meetingId}`, baseUrl).toString()
  } catch {
    return null
  }
}

export async function sendMeetingMinutesEmails(MeetingModel, meeting, options = {}) {
  const sourceUpdatedAt = toOptionalDate(options.sourceUpdatedAt)
    || toOptionalDate(meeting?.aiSummary?.sourceUpdatedAt)
    || toOptionalDate(meeting?.updatedAt)
  const lastSentSourceUpdatedAt = toOptionalDate(meeting?.momEmail?.lastSourceUpdatedAt)

  if (
    lastSentSourceUpdatedAt
    && sourceUpdatedAt
    && lastSentSourceUpdatedAt.getTime() >= sourceUpdatedAt.getTime()
  ) {
    return {
      skipped: true,
      sentCount: 0,
      failedCount: 0,
      recipients: [],
    }
  }

  const mom = buildMeetingMomText(meeting)
  const aiSummary = buildLatestAiSummaryText(meeting)

  if (!mom && !aiSummary) {
    return {
      skipped: true,
      sentCount: 0,
      failedCount: 0,
      recipients: [],
    }
  }

  const recipients = getMeetingMomRecipients(meeting)

  if (recipients.length === 0) {
    return {
      skipped: true,
      sentCount: 0,
      failedCount: 0,
      recipients: [],
    }
  }

  const meetingLink = buildMeetingDetailUrl(meeting?._id, options.origin)
  const results = await Promise.allSettled(
    recipients.map(recipient => sendMeetingMOMEmail({
      to: recipient.to,
      inviteeName: recipient.inviteeName,
      meetingTitle: meeting?.title || 'Meeting',
      mom,
      aiSummary,
      meetingLink,
    }))
  )

  const failedRecipients = results
    .map((result, index) => ({ result, recipient: recipients[index] }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ recipient, result }) => ({
      ...recipient,
      error: result.reason?.message || 'Failed to send MOM email',
    }))

  await MeetingModel.updateOne(
    { _id: meeting._id },
    {
      $set: {
        momEmail: {
          lastSentAt: new Date(),
          lastSourceUpdatedAt: sourceUpdatedAt || new Date(),
          lastSessionNumber: getLatestSummarySession(getExistingSummaryHistory(meeting), meeting)?.sessionNumber || 1,
          recipientCount: recipients.length,
        },
      },
    },
    { timestamps: false }
  )

  return {
    skipped: false,
    sentCount: recipients.length - failedRecipients.length,
    failedCount: failedRecipients.length,
    recipients,
    failedRecipients,
  }
}
