import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import {
  hasMeetingInsightSource,
  generateMeetingInsights,
  persistMeetingInsights,
  sendMeetingMinutesEmails,
} from '@/lib/meetingAI'
import { resolveMeetingEmployee } from '@/lib/meetingParticipants'
import { normalizeMeetingLanguage, sortMeetingTranscript } from '@/lib/meetingLanguage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function canGenerateMeetingInsights(meeting, employee) {
  const employeeId = employee?._id?.toString?.()
  if (!employeeId) return false

  if (meeting.organizer?._id?.toString?.() === employeeId || meeting.organizer?.toString?.() === employeeId) {
    return true
  }

  return meeting.invitees.some(
    invitee => invitee.employee?._id?.toString?.() === employeeId || invitee.employee?.toString?.() === employeeId
  )
}

function toOptionalDate(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getLatestTranscriptTimestamp(transcript = []) {
  let latestTimestamp = null

  for (const segment of transcript) {
    const parsed = toOptionalDate(segment?.timestamp)
    if (!parsed) continue
    if (!latestTimestamp || parsed > latestTimestamp) {
      latestTimestamp = parsed
    }
  }

  return latestTimestamp
}

function getLatestSourceUpdatedAt(meeting, transcript = []) {
  const candidates = [
    toOptionalDate(meeting?.updatedAt),
    getLatestTranscriptTimestamp(transcript),
  ].filter(Boolean)

  if (candidates.length === 0) {
    return new Date()
  }

  return candidates.reduce((latest, candidate) => (candidate > latest ? candidate : latest))
}

function buildScopedMeetingForSummary(meeting, sessionStartedAt, sessionEndedAt) {
  const sourceMeeting = meeting?.toObject ? meeting.toObject() : { ...meeting }
  const transcript = sortMeetingTranscript(sourceMeeting.transcript || [])
  const hasSessionWindow = Boolean(sessionStartedAt || sessionEndedAt)
  const scopedTranscript = hasSessionWindow
    ? transcript.filter(segment => {
        const segmentTimestamp = toOptionalDate(segment?.timestamp)

        if (sessionStartedAt && segmentTimestamp && segmentTimestamp < sessionStartedAt) {
          return false
        }

        if (sessionEndedAt && segmentTimestamp && segmentTimestamp > sessionEndedAt) {
          return false
        }

        return true
      })
    : transcript

  const scopedTranscriptLanguages = [...new Set(
    scopedTranscript
      .map(segment => normalizeMeetingLanguage(segment?.language || 'auto'))
      .filter(Boolean)
      .filter(language => language !== 'auto')
  )]

  const hasPreviousSummary = Boolean(meeting?.aiSummary?.generatedAt || meeting?.aiSummary?.history?.length)

  return {
    meetingForSummary: {
      ...sourceMeeting,
      transcript: scopedTranscript,
      transcriptLanguages: scopedTranscriptLanguages.length > 0
        ? scopedTranscriptLanguages
        : sourceMeeting.transcriptLanguages,
      notes: hasSessionWindow && hasPreviousSummary ? '' : sourceMeeting.notes,
      mom: hasSessionWindow && hasPreviousSummary ? [] : sourceMeeting.mom,
    },
    transcriptForSummary: scopedTranscript,
    hasPreviousSummary,
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { Meeting } = models
    const body = await request.json().catch(() => ({}))
    const requestedLanguage = normalizeMeetingLanguage(body?.language || 'auto')
    const allowNoContent = body?.allowNoContent === true
    const shouldSendMomEmails = body?.sendMomEmails === true
    const sessionStartedAt = toOptionalDate(body?.sessionStartedAt)
    const sessionEndedAt = toOptionalDate(body?.sessionEndedAt)
    const hasSessionWindow = Boolean(sessionStartedAt || sessionEndedAt)

    const employee = await resolveMeetingEmployee(models, user)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const meeting = await Meeting.findById(id)
      .populate('organizer', 'firstName lastName email profilePicture')
      .populate('invitees.employee', 'firstName lastName email profilePicture department')

    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
    }

    if (!canGenerateMeetingInsights(meeting, employee)) {
      return NextResponse.json({ success: false, message: 'You do not have access to generate meeting insights' }, { status: 403 })
    }

    const { meetingForSummary, transcriptForSummary, hasPreviousSummary } = buildScopedMeetingForSummary(
      meeting,
      sessionStartedAt,
      sessionEndedAt,
    )

    if (!hasMeetingInsightSource(meetingForSummary)) {
      const message = hasPreviousSummary
        ? 'No new meeting transcript or notes are available yet for Mira summary generation'
        : 'No meeting transcript or notes are available yet for Mira summary generation'

      if (allowNoContent || hasPreviousSummary) {
        return NextResponse.json({
          success: true,
          message,
          data: {
            generated: false,
            aiSummary: meeting.aiSummary || null,
            participantNotes: meeting.aiParticipantNotes || [],
          },
        })
      }

      return NextResponse.json({
        success: false,
        message,
      }, { status: 400 })
    }

    const latestSourceUpdatedAt = getLatestSourceUpdatedAt(meeting, transcriptForSummary)

    const insights = await generateMeetingInsights(meetingForSummary, { language: requestedLanguage })

    const persistedInsights = await persistMeetingInsights(Meeting, meeting, insights, {
      sourceUpdatedAt: latestSourceUpdatedAt,
      appendHistory: hasSessionWindow,
      replaceLatestHistory: hasPreviousSummary && !hasSessionWindow,
      sessionStartedAt,
      sessionEndedAt,
    })

    let momEmails = null

    if (shouldSendMomEmails) {
      try {
        momEmails = await sendMeetingMinutesEmails(Meeting, {
          ...(meeting?.toObject ? meeting.toObject() : meeting),
          aiSummary: persistedInsights.aiSummary,
          aiParticipantNotes: persistedInsights.aiParticipantNotes,
        }, {
          sourceUpdatedAt: persistedInsights.aiSummary?.sourceUpdatedAt || latestSourceUpdatedAt,
          origin: new URL(request.url).origin,
        })
      } catch (emailError) {
        momEmails = {
          skipped: false,
          sentCount: 0,
          failedCount: 0,
          recipients: [],
          error: emailError.message,
        }
        console.error('Meeting MOM email error:', emailError)
      }
    }

    return NextResponse.json({
      success: true,
      message: hasSessionWindow
        ? (hasPreviousSummary
          ? 'Mira summary updated with the latest meeting session'
          : 'Mira summary generated successfully')
        : (hasPreviousSummary
          ? 'Mira summary refreshed successfully'
          : 'Mira summary generated successfully'),
      data: {
        generated: true,
        aiSummary: persistedInsights.aiSummary,
        participantNotes: persistedInsights.aiParticipantNotes,
        momEmails,
      },
    })
  } catch (error) {
    console.error('Generate AI summary error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { Meeting } = models
    const data = await request.json()
    const { mom, notes } = data

    const employee = await resolveMeetingEmployee(models, user)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const meeting = await Meeting.findById(id)
    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
    }

    const isOrganizer = meeting.organizer.toString() === employee._id.toString()
    const isAcceptedInvitee = meeting.invitees.some(
      invitee => invitee.employee.toString() === employee._id.toString() && ['accepted', 'maybe'].includes(invitee.status)
    )

    if (!isOrganizer && !isAcceptedInvitee) {
      return NextResponse.json({ success: false, message: 'You do not have permission to update meeting notes' }, { status: 403 })
    }

    if (Array.isArray(mom)) {
      meeting.mom = mom
      meeting.momGeneratedAt = new Date()
    }

    if (notes !== undefined) {
      meeting.notes = notes
    }

    await meeting.save()

    return NextResponse.json({
      success: true,
      message: 'Meeting notes updated successfully',
      data: {
        mom: meeting.mom,
        notes: meeting.notes,
      },
    })
  } catch (error) {
    console.error('Update MOM error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
