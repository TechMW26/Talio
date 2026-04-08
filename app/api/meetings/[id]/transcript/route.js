import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { transcribeAudio } from '@/lib/elevenLabs'
import { resolveMeetingEmployee } from '@/lib/meetingAI'
import {
  detectMeetingLanguage,
  mergeTranscriptSegments,
  normalizeMeetingLanguage,
  sortMeetingTranscript,
} from '@/lib/meetingLanguage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function userCanAccessMeeting(meeting, employee) {
  const employeeId = employee?._id?.toString?.()
  if (!employeeId) return false

  const isOrganizer = meeting.organizer.toString() === employeeId
  const isInvitee = meeting.invitees.some(invitee => invitee.employee.toString() === employeeId)

  return isOrganizer || isInvitee
}

function buildTranscriptEntries({ payload, employee, defaultLanguage = 'auto' }) {
  const speakerName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Participant'
  const normalizedSegments = Array.isArray(payload?.segments) && payload.segments.length > 0
    ? payload.segments
    : payload?.text
      ? [{
          text: payload.text,
          timestamp: payload.timestamp,
          language: payload.language,
          startOffsetMs: payload.startOffsetMs,
          endOffsetMs: payload.endOffsetMs,
          segmentId: payload.segmentId,
          source: payload.source,
        }]
      : []

  return normalizedSegments
    .map((segment, index) => {
      const text = String(segment?.text || '').trim()
      if (!text) return null

      const detectedLanguage = normalizeMeetingLanguage(
        segment?.language || detectMeetingLanguage(text, defaultLanguage)
      )

      return {
        segmentId: segment?.segmentId || `${employee._id}-${Date.now()}-${index}`,
        speaker: employee._id,
        speakerName,
        text,
        timestamp: segment?.timestamp ? new Date(segment.timestamp) : new Date(),
        startOffsetMs: segment?.startOffsetMs,
        endOffsetMs: segment?.endOffsetMs,
        source: segment?.source || 'live-transcript',
        language: detectedLanguage,
      }
    })
    .filter(Boolean)
}

function updateMeetingTranscript(meeting, newSegments) {
  const existingTranscript = Array.isArray(meeting.transcript)
    ? meeting.transcript.map(segment => (segment?.toObject ? segment.toObject() : segment))
    : []

  const mergedTranscript = mergeTranscriptSegments(existingTranscript, newSegments)
  meeting.transcript = mergedTranscript
  meeting.transcriptLanguages = [...new Set(
    mergedTranscript
      .map(segment => normalizeMeetingLanguage(segment.language || 'auto'))
      .filter(Boolean)
      .filter(language => language !== 'auto')
  )]
}

async function parseTranscriptPayload(request) {
  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return request.json()
  }

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const text = formData.get('text')
    const language = formData.get('language')
    const source = formData.get('source')
    const segmentId = formData.get('segmentId')
    const timestamp = formData.get('timestamp')
    const startedAt = formData.get('startedAt')
    const durationMs = Number(formData.get('durationMs') || 0) || undefined
    const segmentsJson = formData.get('segments')
    const audio = formData.get('audio')

    if (segmentsJson) {
      return {
        language,
        source,
        segments: JSON.parse(String(segmentsJson)),
      }
    }

    if (text) {
      return {
        text: String(text),
        language,
        source,
        segmentId,
        timestamp,
      }
    }

    if (audio && typeof audio.arrayBuffer === 'function') {
      return {
        audio,
        language,
        source,
        segmentId,
        timestamp,
        startedAt: startedAt || timestamp,
        durationMs,
      }
    }
  }

  throw new Error('Invalid content type for transcript update')
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

    const employee = await resolveMeetingEmployee(models, user)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const meeting = await Meeting.findById(id)
    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
    }

    if (!userCanAccessMeeting(meeting, employee)) {
      return NextResponse.json({ success: false, message: 'You do not have access to this meeting' }, { status: 403 })
    }

    const parsedPayload = await parseTranscriptPayload(request)
    const usingAudioUpload = Boolean(parsedPayload?.audio)

    let payload = parsedPayload

    if (usingAudioUpload) {
      const transcription = await transcribeAudio(parsedPayload.audio, {
        languageCode: parsedPayload.language,
        fileName: parsedPayload.audio?.name || `meeting-${id}-${Date.now()}.webm`,
      })

      if (!transcription.success) {
        return NextResponse.json({ success: false, message: transcription.error }, { status: 502 })
      }

      if (!transcription.text) {
        return NextResponse.json({ success: false, message: 'No speech was detected in the uploaded meeting audio segment' }, { status: 400 })
      }

      payload = {
        text: transcription.text,
        language: transcription.languageCode || parsedPayload.language || 'auto',
        source: parsedPayload.source || 'live-elevenlabs',
        segmentId: parsedPayload.segmentId,
        timestamp: parsedPayload.startedAt || parsedPayload.timestamp,
        startOffsetMs: 0,
        endOffsetMs: parsedPayload.durationMs,
      }
    }

    const segments = buildTranscriptEntries({
      payload,
      employee,
      defaultLanguage: payload?.language || 'auto',
    })

    if (segments.length === 0) {
      return NextResponse.json({ success: false, message: 'No transcript content provided' }, { status: 400 })
    }

    updateMeetingTranscript(meeting, segments)
    await meeting.save()

    return NextResponse.json({
      success: true,
      message: 'Transcript updated',
      data: {
        transcriptCount: meeting.transcript.length,
        languages: meeting.transcriptLanguages || [],
        provider: usingAudioUpload ? 'elevenlabs' : 'client',
        segments,
      },
    })
  } catch (error) {
    console.error('Transcript error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

export async function GET(request, { params }) {
  try {
    const { id } = await params
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { Meeting } = models

    const employee = await resolveMeetingEmployee(models, user)
    const meeting = await Meeting.findById(id)
      .select('transcript transcriptLanguages organizer invitees')
      .populate('transcript.speaker', 'firstName lastName')

    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
    }

    if (!userCanAccessMeeting(meeting, employee)) {
      return NextResponse.json({ success: false, message: 'You do not have access to this meeting' }, { status: 403 })
    }

    const transcript = sortMeetingTranscript(
      (meeting.transcript || []).map(segment => (segment?.toObject ? segment.toObject() : segment))
    )

    return NextResponse.json({
      success: true,
      data: {
        transcript,
        languages: meeting.transcriptLanguages || [],
      },
    })
  } catch (error) {
    console.error('Get transcript error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
