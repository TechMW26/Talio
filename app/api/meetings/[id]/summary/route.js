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

// POST - Generate AI summary from transcript or MOM
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

    const data = await request.json()
    const { language = 'en' } = data // en, hi, hinglish

    const meeting = await Meeting.findById(id)
      .populate('organizer', 'firstName lastName')
      .populate('invitees.employee', 'firstName lastName')

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

    // Only organizer can generate summary
    if (meeting.organizer._id.toString() !== employee?._id?.toString()) {
      return NextResponse.json({ 
        success: false, 
        message: 'Only the organizer can generate AI summary' 
      }, { status: 403 })
    }

    // Build content for AI to summarize
    let contentToSummarize = `Meeting: ${meeting.title}\n`
    contentToSummarize += `Date: ${new Date(meeting.scheduledStart).toLocaleDateString()}\n`
    contentToSummarize += `Duration: ${meeting.duration} minutes\n`
    contentToSummarize += `Type: ${meeting.type}\n\n`

    if (meeting.description) {
      contentToSummarize += `Description: ${meeting.description}\n\n`
    }

    if (meeting.agenda?.length > 0) {
      contentToSummarize += `Agenda:\n`
      meeting.agenda.forEach((item, i) => {
        contentToSummarize += `${i + 1}. ${item.title} (${item.duration} min)\n`
      })
      contentToSummarize += '\n'
    }

    if (meeting.transcript?.length > 0) {
      contentToSummarize += `Transcript:\n`
      meeting.transcript.forEach(segment => {
        contentToSummarize += `[${segment.speakerName || 'Unknown'}]: ${segment.text}\n`
      })
      contentToSummarize += '\n'
    }

    if (meeting.mom?.length > 0) {
      contentToSummarize += `Minutes of Meeting:\n`
      meeting.mom.forEach((item, i) => {
        contentToSummarize += `Topic ${i + 1}: ${item.topic}\n`
        if (item.discussion) contentToSummarize += `Discussion: ${item.discussion}\n`
        if (item.decisions?.length) contentToSummarize += `Decisions: ${item.decisions.join(', ')}\n`
        contentToSummarize += '\n'
      })
    }

    if (meeting.notes) {
      contentToSummarize += `Meeting Notes:\n${meeting.notes}\n`
    }

    // Generate language-specific prompt
    let languageInstruction = ''
    switch (language) {
      case 'hi':
        languageInstruction = 'Please respond entirely in Hindi (Devanagari script).'
        break
      case 'hinglish':
        languageInstruction = 'Please respond in Hinglish (Hindi words written in Roman script mixed with English).'
        break
      default:
        languageInstruction = 'Please respond in English.'
    }

    // Get OpenAI client (lazy initialization)
    const openaiClient = getOpenAIClient()
    if (!openaiClient) {
      return NextResponse.json({ 
        success: false, 
        message: 'OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.' 
      }, { status: 500 })
    }

    const completion = await openaiClient.chat.completions.create({
      model: process.env.NEXT_PUBLIC_OPENAI_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a professional meeting summarizer. Your task is to create a comprehensive summary of the meeting content provided. ${languageInstruction}
          
          Please provide:
          1. A brief summary (2-3 paragraphs)
          2. Key points discussed (bullet list)
          3. Action items (bullet list with owner if mentioned)
          4. Decisions made (bullet list)
          5. Next steps (bullet list)
          
          Format your response as JSON with the following structure:
          {
            "summary": "...",
            "keyPoints": ["...", "..."],
            "actionItems": ["...", "..."],
            "decisions": ["...", "..."],
            "nextSteps": ["...", "..."]
          }`
        },
        {
          role: 'user',
          content: contentToSummarize
        }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    })

    const aiResponse = JSON.parse(completion.choices[0].message.content)

    // Update meeting with AI summary
    meeting.aiSummary = {
      summary: aiResponse.summary,
      keyPoints: aiResponse.keyPoints || [],
      actionItems: aiResponse.actionItems || [],
      decisions: aiResponse.decisions || [],
      nextSteps: aiResponse.nextSteps || [],
      generatedAt: new Date(),
      language
    }

    await meeting.save()

    return NextResponse.json({
      success: true,
      message: 'AI summary generated successfully',
      data: meeting.aiSummary
    })
  } catch (error) {
    console.error('Generate AI summary error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// PUT - Add/Update MOM
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
    const { mom, notes } = data

    const meeting = await Meeting.findById(id)

    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
    }

    // Get current user's employee record - first check User.employeeId, then Employee.userId
    const userRecord = await User.findById(decoded.userId).select('employeeId').lean()
    
    let employee = null
    if (userRecord?.employeeId) {
      employee = await Employee.findById(userRecord.employeeId).lean()
    }
    
    // If user doesn't have employeeId directly, try to find employee by userId
    if (!employee) {
      employee = await Employee.findOne({ userId: decoded.userId }).lean()
    }

    // Only organizer or accepted invitees can add MOM
    const isOrganizer = meeting.organizer.toString() === employee?._id?.toString()
    const isAcceptedInvitee = meeting.invitees.some(
      i => i.employee.toString() === employee?._id?.toString() && i.status === 'accepted'
    )

    if (!isOrganizer && !isAcceptedInvitee) {
      return NextResponse.json({ 
        success: false, 
        message: 'You do not have permission to add MOM' 
      }, { status: 403 })
    }

    if (mom && Array.isArray(mom)) {
      meeting.mom = mom
      meeting.momGeneratedAt = new Date()
    }

    if (notes !== undefined) {
      meeting.notes = notes
    }

    await meeting.save()

    return NextResponse.json({
      success: true,
      message: 'MOM updated successfully',
      data: { mom: meeting.mom, notes: meeting.notes }
    })
  } catch (error) {
    console.error('Update MOM error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
