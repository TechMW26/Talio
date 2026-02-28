import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { logActivity } from '@/lib/activityLogger'
import { emitRecruitmentUpdate, emitCandidateStageChanged } from '@/lib/realtimeEvents'

const ALLOWED_ROLES = ['admin', 'hr', 'manager']
const VALID_STAGES = ['applied', 'screening', 'shortlisted', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn']

// GET - List candidates with filters & pagination
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['Candidate', 'JobPosting', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Candidate } = models

    const { searchParams } = new URL(request.url)
    const jobPosting = searchParams.get('jobPosting')
    const stage = searchParams.get('stage')
    const source = searchParams.get('source')
    const search = searchParams.get('search')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 1 : -1

    const query = {}
    if (jobPosting) query.jobPosting = jobPosting
    if (stage) query.stage = stage
    if (source) query.source = source

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { currentCompany: { $regex: search, $options: 'i' } },
        { skills: { $regex: search, $options: 'i' } },
      ]
    }

    const skip = (page - 1) * limit

    const [candidates, total] = await Promise.all([
      Candidate.find(query)
        .populate('jobPosting', 'jobTitle jobCode department status')
        .populate('referredBy', 'firstName lastName')
        .populate('createdBy', 'firstName lastName')
        .populate('notes.addedBy', 'firstName lastName')
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      Candidate.countDocuments(query),
    ])

    return NextResponse.json({
      success: true,
      data: candidates,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    })
  } catch (error) {
    console.error('Get candidates error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch candidates' },
      { status: 500 }
    )
  }
}

// POST - Create candidate / apply to job
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['Candidate', 'JobPosting', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Candidate, JobPosting } = models

    if (!ALLOWED_ROLES.includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Insufficient permissions' }, { status: 403 })
    }

    const data = await request.json()

    // Validation
    if (!data.firstName?.trim()) {
      return NextResponse.json({ success: false, message: 'First name is required' }, { status: 400 })
    }
    if (!data.lastName?.trim()) {
      return NextResponse.json({ success: false, message: 'Last name is required' }, { status: 400 })
    }
    if (!data.email?.trim()) {
      return NextResponse.json({ success: false, message: 'Email is required' }, { status: 400 })
    }
    if (!data.jobPosting) {
      return NextResponse.json({ success: false, message: 'Job posting is required' }, { status: 400 })
    }

    // Verify job exists and is open
    const job = await JobPosting.findById(data.jobPosting)
    if (!job) {
      return NextResponse.json({ success: false, message: 'Job posting not found' }, { status: 404 })
    }
    if (!['open', 'draft'].includes(job.status)) {
      return NextResponse.json({ success: false, message: 'Job posting is not accepting applications' }, { status: 400 })
    }

    // Check for duplicate application
    const existingCandidate = await Candidate.findOne({
      email: data.email.toLowerCase().trim(),
      jobPosting: data.jobPosting,
    })
    if (existingCandidate) {
      return NextResponse.json(
        { success: false, message: 'This candidate has already applied for this position' },
        { status: 409 }
      )
    }

    // Set defaults
    data.stage = data.stage || 'applied'
    data.createdBy = user.employeeId?._id || user.employeeId
    data.stageHistory = [{
      stage: data.stage,
      movedAt: new Date(),
      movedBy: data.createdBy,
      notes: 'Application submitted',
    }]

    const candidate = await Candidate.create(data)
    const populated = await Candidate.findById(candidate._id)
      .populate('jobPosting', 'jobTitle jobCode department status')
      .populate('referredBy', 'firstName lastName')
      .populate('createdBy', 'firstName lastName')

    try {
      await logActivity({
        employeeId: data.createdBy,
        type: 'recruitment_candidate_create',
        action: 'Added candidate',
        details: `Added candidate ${data.firstName} ${data.lastName} for ${job.jobTitle}`,
        metadata: { candidateId: candidate._id, jobId: data.jobPosting },
        relatedModel: 'Candidate',
        relatedId: candidate._id,
      })
    } catch (e) {
      console.error('Activity log error (non-critical):', e)
    }

    emitRecruitmentUpdate(populated.toObject ? populated.toObject() : populated, { action: 'candidate-added' })

    return NextResponse.json(
      { success: true, message: 'Candidate added successfully', data: populated },
      { status: 201 }
    )
  } catch (error) {
    console.error('Create candidate error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to add candidate' },
      { status: 500 }
    )
  }
}
