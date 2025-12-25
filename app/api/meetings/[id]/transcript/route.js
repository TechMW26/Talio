import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'

// Lazy initialization of OpenAI client to avoid build-time errors
let openai = null
function getOpenAIClient() {
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  }
  return openai
}

// POST - Add transcript segment or process audio for transcription
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
    const { models } = auth
    const { Meeting, Employee, User } = models

    const contentType = request.headers.get('content-type')

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

    // Check if user has access
    const isOrganizer = meeting.organizer.toString() === employee._id.toString()
    const isInvitee = meeting.invitees.some(
      i => i.employee.toString() === employee._id.toString()
    )

    if (!isOrganizer && !isInvitee) {
      return NextResponse.json({ 
        success: false, 
        message: 'You do not have access to this meeting' 
      }, { status: 403 })
    }

    // Handle JSON transcript segments (real-time or manual)
    if (contentType?.includes('application/json')) {
      const data = await request.json()
      const { segments, text, language = 'en' } = data

      if (segments && Array.isArray(segments)) {
        // Add multiple segments
        for (const segment of segments) {
          meeting.transcript.push({
            speaker: segment.speakerId || employee._id,
            speakerName: segment.speakerName || `${employee.firstName} ${employee.lastName}`,
            text: segment.text,
            timestamp: segment.timestamp || new Date(),
            language: segment.language || language
          })
        }
      } else if (text) {
        // Add single segment
        meeting.transcript.push({
          speaker: employee._id,
          speakerName: `${employee.firstName} ${employee.lastName}`,
          text,
          timestamp: new Date(),
          language
        })
      }

      // Update transcript languages
      const languages = [...new Set(meeting.transcript.map(t => t.language))]
      meeting.transcriptLanguages = languages

      await meeting.save()

      return NextResponse.json({
        success: true,
        message: 'Transcript updated',
        data: { transcriptCount: meeting.transcript.length }
      })
    }

    // Handle audio file upload for transcription
    if (contentType?.includes('multipart/form-data')) {
      const formData = await request.formData()
      const audioFile = formData.get('audio')
      const language = formData.get('language') || 'en'

      if (!audioFile) {
        return NextResponse.json({ 
          success: false, 
          message: 'No audio file provided' 
        }, { status: 400 })
      }

      // Convert to buffer for Whisper API
      const buffer = Buffer.from(await audioFile.arrayBuffer())
      
      // Create a File object for OpenAI
      const file = new File([buffer], audioFile.name || 'audio.webm', {
        type: audioFile.type || 'audio/webm'
      })

      // Get OpenAI client (lazy initialization)
      const openaiClient = getOpenAIClient()
      if (!openaiClient) {
        return NextResponse.json({ 
          success: false, 
          message: 'OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.' 
        }, { status: 500 })
      }

      // Transcribe using Whisper
      const transcription = await openaiClient.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: language === 'hinglish' ? 'hi' : language,
        response_format: 'verbose_json'
      })

      // Parse segments from Whisper response
      if (transcription.segments) {
        for (const segment of transcription.segments) {
          meeting.transcript.push({
            speaker: employee._id,
            speakerName: `${employee.firstName} ${employee.lastName}`,
            text: segment.text,
            timestamp: new Date(meeting.scheduledStart.getTime() + (segment.start * 1000)),
            language: language === 'hinglish' ? 'hinglish' : (transcription.language || language)
          })
        }
      } else {
        // Single transcript text
        meeting.transcript.push({
          speaker: employee._id,
          speakerName: `${employee.firstName} ${employee.lastName}`,
          text: transcription.text,
          timestamp: new Date(),
          language: language === 'hinglish' ? 'hinglish' : (transcription.language || language)
        })
      }

      // Update transcript languages
      const languages = [...new Set(meeting.transcript.map(t => t.language))]
      meeting.transcriptLanguages = languages

      await meeting.save()

      return NextResponse.json({
        success: true,
        message: 'Audio transcribed successfully',
        data: {
          text: transcription.text,
          language: transcription.language,
          duration: transcription.duration,
          segmentCount: transcription.segments?.length || 1
        }
      })
    }

    return NextResponse.json({ 
      success: false, 
      message: 'Invalid content type' 
    }, { status: 400 })
  } catch (error) {
    console.error('Transcript error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// GET - Get transcript
export async function GET(request, { params }) {
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

    const meeting = await Meeting.findById(id)
      .select('transcript transcriptLanguages organizer invitees')
      .populate('transcript.speaker', 'firstName lastName')

    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
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

    // Check access
    const isOrganizer = meeting.organizer.toString() === employee?._id?.toString()
    const isInvitee = meeting.invitees.some(
      i => i.employee.toString() === employee?._id?.toString()
    )

    if (!isOrganizer && !isInvitee) {
      return NextResponse.json({ 
        success: false, 
        message: 'You do not have access to this meeting' 
      }, { status: 403 })
    }

    return NextResponse.json({
      success: true,
      data: {
        transcript: meeting.transcript,
        languages: meeting.transcriptLanguages
      }
    })
  } catch (error) {
    console.error('Get transcript error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
