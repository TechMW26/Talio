import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
// GET - Get single job posting
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Recruitment'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Recruitment } = models

    const job = await Recruitment.findById(params.id)
      .populate('department', 'name')
      .populate('hiringManager', 'firstName lastName')

    if (!job) {
      return NextResponse.json(
        { success: false, message: 'Job posting not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: job,
    })
  } catch (error) {
    console.error('Get job error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch job posting' },
      { status: 500 }
    )
  }
}

// PUT - Update job posting
export async function PUT(request, { params }) {
  try {
    const data = await request.json()

    const job = await Recruitment.findByIdAndUpdate(
      params.id,
      data,
      { new: true, runValidators: true }
    )
      .populate('department', 'name')
      .populate('hiringManager', 'firstName lastName')

    if (!job) {
      return NextResponse.json(
        { success: false, message: 'Job posting not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Job posting updated successfully',
      data: job,
    })
  } catch (error) {
    console.error('Update job error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update job posting' },
      { status: 500 }
    )
  }
}

// DELETE - Delete job posting
export async function DELETE(request, { params }) {
  try {
    const job = await Recruitment.findByIdAndDelete(params.id)

    if (!job) {
      return NextResponse.json(
        { success: false, message: 'Job posting not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Job posting deleted successfully',
    })
  } catch (error) {
    console.error('Delete job error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete job posting' },
      { status: 500 }
    )
  }
}

