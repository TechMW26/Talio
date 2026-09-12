import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { saveMeetingAudio, readMeetingAudio, deleteMeetingAudio, validateAudioSegment } from '@/lib/platform/meetingAudio.server'

export const dynamic = 'force-dynamic'

// POST - Upload audio segment from offline meeting
export async function POST(request, { params }) {
  try {
    const { id } = await params

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { Meeting, Employee, User } = models

    const formData = await request.formData();
    const audioFile = formData.get('audio');
    const duration = parseFloat(formData.get('duration') || '0');

    const audioError = validateAudioSegment(audioFile, duration)
    if (audioError) {
      return NextResponse.json({ 
        success: false, 
        message: audioError
      }, { status: 400 });
    }

    // Get current user's employee record - first check User.employeeId, then Employee.userId
    const userRecord = await User.findById(user._id || user.userId).select('employeeId').lean()
    
    let employee = null
    if (userRecord?.employeeId) {
      employee = await Employee.findById(userRecord.employeeId).lean()
    }
    
    // If user doesn't have employeeId directly, try to find employee by userId
    if (!employee) {
      employee = await Employee.findOne({ userId: user._id || user.userId }).lean()
    }

    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const meeting = await Meeting.findById(id)

    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
    }

    // Check if user is an accepted invitee or organizer
    const isOrganizer = meeting.organizer.toString() === employee._id.toString()
    const invitee = meeting.invitees.find(
      i => i.employee.toString() === employee._id.toString()
    )

    if (!isOrganizer && !invitee) {
      return NextResponse.json({ 
        success: false, 
        message: 'You are not part of this meeting' 
      }, { status: 403 })
    }

    // Check audio consent for offline meetings
    if (meeting.type === 'offline' && invitee && !invitee.audioConsent) {
      return NextResponse.json({ 
        success: false, 
        message: 'Audio consent required for offline meeting recording' 
      }, { status: 403 })
    }

    const fileId = await saveMeetingAudio({
      databaseName: tenant.databaseName, meetingId: id, employeeId: employee._id, file: audioFile,
    })
    const audioUrl = `/api/meetings/${id}/audio?segment=${fileId}`

    // Add to offline audio segments
    if (!meeting.offlineAudio) {
      meeting.offlineAudio = { segments: [], processingStatus: 'pending' }
    }

    meeting.offlineAudio.segments.push({
      employee: employee._id,
      url: audioUrl,
      duration,
      uploadedAt: new Date()
    })

    try {
      await meeting.save()
    } catch (error) {
      await deleteMeetingAudio(tenant.databaseName, fileId).catch(() => {})
      throw error
    }

    return NextResponse.json({
      success: true,
      message: 'Audio uploaded successfully',
      data: {
        url: audioUrl,
        segmentCount: meeting.offlineAudio.segments.length
      }
    })
  } catch (error) {
    console.error('Upload audio error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// PUT - Update audio consent for offline meeting
export async function PUT(request, { params }) {
  try {
    const { id } = await params

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Meeting, Employee, User } = models

    const data = await request.json()
    const { consent } = data

    // Get current user's employee record - first check User.employeeId, then Employee.userId
    const userRecord = await User.findById(user._id || user.userId).select('employeeId').lean()
    
    let employee = null
    if (userRecord?.employeeId) {
      employee = await Employee.findById(userRecord.employeeId).lean()
    }
    
    // If user doesn't have employeeId directly, try to find employee by userId
    if (!employee) {
      employee = await Employee.findOne({ userId: user._id || user.userId }).lean()
    }

    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const meeting = await Meeting.findById(id)

    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
    }

    // Find user's invitee entry
    const inviteeIndex = meeting.invitees.findIndex(
      i => i.employee.toString() === employee._id.toString()
    )

    if (inviteeIndex === -1) {
      return NextResponse.json({ 
        success: false, 
        message: 'You are not invited to this meeting' 
      }, { status: 403 })
    }

    // Update audio consent
    meeting.invitees[inviteeIndex].audioConsent = consent

    await meeting.save()

    return NextResponse.json({
      success: true,
      message: consent ? 'Audio consent granted' : 'Audio consent revoked',
      data: { audioConsent: consent }
    })
  } catch (error) {
    console.error('Update audio consent error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}


// Private delivery requires membership in this meeting as well as the tenant.
export async function GET(request, { params }) {
  const auth = await getAuthAndModels(request, ['Meeting', 'User', 'Employee'])
  if (!auth.success) return new NextResponse('Unauthorized', { status: 401 })
  const { id } = await params
  const segment = new URL(request.url).searchParams.get('segment')
  try {
    const userId = auth.user._id || auth.user.userId
    const user = await auth.models.User.findById(userId).select('employeeId').lean()
    const employee = user?.employeeId
      ? { _id: user.employeeId }
      : await auth.models.Employee.findOne({ userId }).select('_id').lean()
    const meeting = await auth.models.Meeting.findById(id).select('organizer invitees offlineAudio').lean()
    if (!meeting || !employee) return new NextResponse('Not found', { status: 404 })
    const member = String(meeting.organizer) === String(employee._id)
      || (meeting.invitees || []).some(invitee => String(invitee.employee) === String(employee._id))
    if (!member) return new NextResponse('Forbidden', { status: 403 })
    const result = await readMeetingAudio(auth.tenant.databaseName, id, segment)
    if (!result) return new NextResponse('Not found', { status: 404 })
    return new NextResponse(result.stream, { headers: {
      'Content-Type': result.file.metadata.contentType,
      'Content-Length': String(result.file.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch (error) {
    console.error('[MeetingAudio] Read failed:', error.message)
    return new NextResponse('Audio unavailable', { status: 500 })
  }
}
