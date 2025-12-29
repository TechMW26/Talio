import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { emitRecruitmentUpdate } from '@/lib/realtimeEvents'

// GET - List job postings
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Recruitment'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Recruitment } = models

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    const query = {}

    if (status) {
      query.status = status
    }

    const jobs = await Recruitment.find(query)
      .populate('department', 'name')
      .populate('hiringManager', 'firstName lastName')
      .sort({ createdAt: -1 })

    return NextResponse.json({
      success: true,
      data: jobs,
    })
  } catch (error) {
    console.error('Get recruitment error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch job postings' },
      { status: 500 }
    )
  }
}

// POST - Create job posting
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Recruitment'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Recruitment } = models

    const data = await request.json()

    const job = await Recruitment.create(data)

    const populatedJob = await Recruitment.findById(job._id)
      .populate('department', 'name')
      .populate('hiringManager', 'firstName lastName')

    // Emit real-time event for recruitment updates
    emitRecruitmentUpdate(populatedJob.toObject ? populatedJob.toObject() : populatedJob, { action: 'create' })

    return NextResponse.json({
      success: true,
      message: 'Job posting created successfully',
      data: populatedJob,
    }, { status: 201 })
  } catch (error) {
    console.error('Create recruitment error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create job posting' },
      { status: 500 }
    )
  }
}

