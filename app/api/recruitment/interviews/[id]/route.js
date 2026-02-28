import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { logActivity } from '@/lib/activityLogger'
import { emitInterviewUpdate } from '@/lib/realtimeEvents'

// GET - Get single interview
export async function GET(request, { params }) {
  try {
    const { id } = await params
    const auth = await getAuthAndModels(request, ['Interview', 'Candidate', 'JobPosting', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Interview } = models

    const interview = await Interview.findById(id)
      .populate('candidate', 'firstName lastName email phone stage resume skills')
      .populate('jobPosting', 'jobTitle jobCode department')
      .populate('interviewers', 'firstName lastName email')
      .populate('feedback.interviewer', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName')
      .lean()

    if (!interview) {
      return NextResponse.json({ success: false, message: 'Interview not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: interview })
  } catch (error) {
    console.error('Get interview error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch interview' },
      { status: 500 }
    )
  }
}

// PUT - Update interview (reschedule, add feedback, change status)
export async function PUT(request, { params }) {
  try {
    const { id } = await params
    const auth = await getAuthAndModels(request, ['Interview', 'Candidate', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Interview } = models

    const data = await request.json()
    const existing = await Interview.findById(id)
    if (!existing) {
      return NextResponse.json({ success: false, message: 'Interview not found' }, { status: 404 })
    }

    const employeeId = user.employeeId?._id || user.employeeId

    // Handle feedback submission
    if (data.feedback) {
      const feedbackEntry = {
        interviewer: employeeId,
        rating: data.feedback.rating,
        strengths: data.feedback.strengths,
        weaknesses: data.feedback.weaknesses,
        comments: data.feedback.comments,
        recommendation: data.feedback.recommendation,
        submittedAt: new Date(),
      }

      // Check if this interviewer already submitted feedback
      const existingFeedbackIdx = existing.feedback.findIndex(
        f => f.interviewer?.toString() === employeeId?.toString()
      )
      if (existingFeedbackIdx >= 0) {
        existing.feedback[existingFeedbackIdx] = feedbackEntry
      } else {
        existing.feedback.push(feedbackEntry)
      }
      data.feedback = existing.feedback

      // Auto-complete if all interviewers submitted
      if (existing.interviewers?.length === data.feedback.length) {
        data.status = 'completed'
      }
    }

    const interview = await Interview.findByIdAndUpdate(id, data, { new: true, runValidators: true })
      .populate('candidate', 'firstName lastName email phone stage')
      .populate('jobPosting', 'jobTitle jobCode department')
      .populate('interviewers', 'firstName lastName email')
      .populate('feedback.interviewer', 'firstName lastName')
      .populate('createdBy', 'firstName lastName')

    try {
      await logActivity({
        employeeId,
        type: 'recruitment_interview_update',
        action: 'Updated interview',
        details: `Updated interview #${interview.round}`,
        metadata: { interviewId: id, changes: Object.keys(data) },
        relatedModel: 'Interview',
        relatedId: id,
      })
    } catch (e) {
      console.error('Activity log error (non-critical):', e)
    }

    emitInterviewUpdate(interview.toObject ? interview.toObject() : interview, { action: 'update' })

    return NextResponse.json({
      success: true,
      message: 'Interview updated successfully',
      data: interview,
    })
  } catch (error) {
    console.error('Update interview error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update interview' },
      { status: 500 }
    )
  }
}

// DELETE - Cancel/delete interview
export async function DELETE(request, { params }) {
  try {
    const { id } = await params
    const auth = await getAuthAndModels(request, ['Interview'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Interview } = models

    if (!['admin', 'hr', 'manager'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Insufficient permissions' }, { status: 403 })
    }

    const interview = await Interview.findById(id)
    if (!interview) {
      return NextResponse.json({ success: false, message: 'Interview not found' }, { status: 404 })
    }

    await Interview.findByIdAndDelete(id)

    return NextResponse.json({ success: true, message: 'Interview deleted successfully' })
  } catch (error) {
    console.error('Delete interview error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete interview' },
      { status: 500 }
    )
  }
}
