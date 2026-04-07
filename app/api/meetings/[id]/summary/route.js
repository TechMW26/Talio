import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import {
  hasMeetingInsightSource,
  generateMeetingInsights,
  persistMeetingInsights,
  resolveMeetingEmployee,
} from '@/lib/meetingAI'
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

    const transcript = sortMeetingTranscript(meeting.transcript || [])
    if (!hasMeetingInsightSource(meeting)) {
      return NextResponse.json({
        success: false,
        message: 'No meeting transcript or notes are available yet for AI summary generation',
      }, { status: 400 })
    }

    meeting.transcript = transcript

    const insights = await generateMeetingInsights(meeting, { language: requestedLanguage })

    const persistedInsights = await persistMeetingInsights(Meeting, meeting, insights, {
      sourceUpdatedAt: meeting.updatedAt,
    })

    return NextResponse.json({
      success: true,
      message: 'Meeting summary generated successfully',
      data: {
        aiSummary: persistedInsights.aiSummary,
        participantNotes: persistedInsights.aiParticipantNotes,
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
