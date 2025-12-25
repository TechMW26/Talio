import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

// POST - Upload audio segment from offline meeting
export async function POST(request, { params }) {
  try {
    const { id } = await params

    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Meeting, Employee, User } = models

    const formData = await request.formData()
    const audioFile = formData.get('audio')
    const duration = parseFloat(formData.get('duration') || '0')

    if (!audioFile) {
      return NextResponse.json({ 
        success: false, 
        message: 'No audio file provided' 
      }, { status: 400 })
    }

    // Get current user's employee record - first check User.employeeId, then Employee.userId
    const user = await User.findById(decoded.userId).select('employeeId').lean()
    
    let employee = null
    if (user?.employeeId) {
      employee = await Employee.findById(user.employeeId).lean()
    }
    
    // If user doesn't have employeeId directly, try to find employee by userId
    if (!employee) {
      employee = await Employee.findOne({ userId: decoded.userId }).lean()
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

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'meetings', id.toString())
    await mkdir(uploadsDir, { recursive: true })

    // Save audio file
    const timestamp = Date.now()
    const fileName = `audio-${employee._id}-${timestamp}.webm`
    const filePath = path.join(uploadsDir, fileName)
    
    const buffer = Buffer.from(await audioFile.arrayBuffer())
    await writeFile(filePath, buffer)

    const audioUrl = `/uploads/meetings/${id}/${fileName}`

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

    await meeting.save()

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

    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const data = await request.json()
    const { consent } = data

    // Get current user's employee record - first check User.employeeId, then Employee.userId
    const user = await User.findById(decoded.userId).select('employeeId').lean()
    
    let employee = null
    if (user?.employeeId) {
      employee = await Employee.findById(user.employeeId).lean()
    }
    
    // If user doesn't have employeeId directly, try to find employee by userId
    if (!employee) {
      employee = await Employee.findOne({ userId: decoded.userId }).lean()
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
