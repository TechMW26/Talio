import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { logActivity } from '@/lib/activityLogger'
import { emitInterviewUpdate } from '@/lib/realtimeEvents'

const ALLOWED_ROLES = ['admin', 'hr', 'manager']

// GET - List interviews with filters & pagination
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['Interview', 'Candidate', 'JobPosting', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Interview } = models

    const { searchParams } = new URL(request.url)
    const jobPosting = searchParams.get('jobPosting')
    const candidate = searchParams.get('candidate')
    const status = searchParams.get('status')
    const interviewer = searchParams.get('interviewer')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))

    const query = {}
    if (jobPosting) query.jobPosting = jobPosting
    if (candidate) query.candidate = candidate
    if (status) query.status = status
    if (interviewer) query.interviewers = interviewer

    // Interviewers can only see their own interviews
    if (!ALLOWED_ROLES.includes(user.role)) {
      const empId = user.employeeId?._id || user.employeeId
      query.interviewers = empId
    }

    if (dateFrom || dateTo) {
      query.scheduledDate = {}
      if (dateFrom) query.scheduledDate.$gte = new Date(dateFrom)
      if (dateTo) query.scheduledDate.$lte = new Date(dateTo)
    }

    const skip = (page - 1) * limit

    const [interviews, total] = await Promise.all([
      Interview.find(query)
        .populate('candidate', 'firstName lastName email phone stage')
        .populate('jobPosting', 'jobTitle jobCode department')
        .populate('interviewers', 'firstName lastName email')
        .populate('feedback.interviewer', 'firstName lastName')
        .populate('createdBy', 'firstName lastName')
        .sort({ scheduledDate: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Interview.countDocuments(query),
    ])

    return NextResponse.json({
      success: true,
      data: interviews,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    })
  } catch (error) {
    console.error('Get interviews error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch interviews' },
      { status: 500 }
    )
  }
}

// POST - Schedule interview
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['Interview', 'Candidate', 'JobPosting', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Interview, Candidate, JobPosting } = models

    if (!ALLOWED_ROLES.includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Insufficient permissions' }, { status: 403 })
    }

    const data = await request.json()

    // Validation
    if (!data.candidate) {
      return NextResponse.json({ success: false, message: 'Candidate is required' }, { status: 400 })
    }
    if (!data.jobPosting) {
      return NextResponse.json({ success: false, message: 'Job posting is required' }, { status: 400 })
    }
    if (!data.scheduledDate) {
      return NextResponse.json({ success: false, message: 'Scheduled date is required' }, { status: 400 })
    }
    if (!data.interviewers || data.interviewers.length === 0) {
      return NextResponse.json({ success: false, message: 'At least one interviewer is required' }, { status: 400 })
    }

    // Verify candidate exists
    const candidateDoc = await Candidate.findById(data.candidate)
    if (!candidateDoc) {
      return NextResponse.json({ success: false, message: 'Candidate not found' }, { status: 404 })
    }

    // Auto-set round number
    if (!data.round) {
      const existingRounds = await Interview.countDocuments({
        candidate: data.candidate,
        jobPosting: data.jobPosting,
      })
      data.round = existingRounds + 1
    }

    data.createdBy = user.employeeId?._id || user.employeeId

    const interview = await Interview.create(data)
    const populated = await Interview.findById(interview._id)
      .populate('candidate', 'firstName lastName email phone stage')
      .populate('jobPosting', 'jobTitle jobCode department')
      .populate('interviewers', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName')

    // Move candidate to interview stage if still in earlier stage
    const earlyStages = ['applied', 'screening', 'shortlisted']
    if (earlyStages.includes(candidateDoc.stage)) {
      candidateDoc.stage = 'interview'
      if (!candidateDoc.stageHistory) candidateDoc.stageHistory = []
      candidateDoc.stageHistory.push({
        stage: 'interview',
        movedAt: new Date(),
        movedBy: data.createdBy,
        notes: `Interview round ${data.round} scheduled`,
      })
      await candidateDoc.save()
    }

    try {
      await logActivity({
        employeeId: data.createdBy,
        type: 'recruitment_interview_schedule',
        action: 'Scheduled interview',
        details: `Scheduled round ${data.round} interview for ${candidateDoc.firstName} ${candidateDoc.lastName}`,
        metadata: { interviewId: interview._id, candidateId: data.candidate },
        relatedModel: 'Interview',
        relatedId: interview._id,
      })
    } catch (e) {
      console.error('Activity log error (non-critical):', e)
    }

    emitInterviewUpdate(populated.toObject ? populated.toObject() : populated, { action: 'schedule' })

    return NextResponse.json(
      { success: true, message: 'Interview scheduled successfully', data: populated },
      { status: 201 }
    )
  } catch (error) {
    console.error('Schedule interview error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to schedule interview' },
      { status: 500 }
    )
  }
}
