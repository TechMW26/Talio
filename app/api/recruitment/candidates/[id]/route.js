import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { logActivity } from '@/lib/activityLogger'
import { emitCandidateStageChanged, emitRecruitmentUpdate } from '@/lib/realtimeEvents'

const ALLOWED_ROLES = ['admin', 'hr', 'manager']

// GET - Get single candidate with full history
export async function GET(request, { params }) {
  try {
    const { id } = await params
    const auth = await getAuthAndModels(request, ['Candidate', 'JobPosting', 'Interview', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Candidate, Interview } = models

    const candidate = await Candidate.findById(id)
      .populate('jobPosting', 'jobTitle jobCode department status hiringManager')
      .populate('referredBy', 'firstName lastName')
      .populate('createdBy', 'firstName lastName')
      .populate('notes.addedBy', 'firstName lastName')
      .populate('stageHistory.movedBy', 'firstName lastName')
      .populate('convertedEmployeeId', 'firstName lastName employeeCode')
      .lean()

    if (!candidate) {
      return NextResponse.json({ success: false, message: 'Candidate not found' }, { status: 404 })
    }

    // Fetch interviews for this candidate
    const interviews = await Interview.find({ candidate: id })
      .populate('interviewers', 'firstName lastName email')
      .populate('feedback.interviewer', 'firstName lastName')
      .populate('createdBy', 'firstName lastName')
      .sort({ scheduledDate: 1 })
      .lean()

    return NextResponse.json({
      success: true,
      data: { ...candidate, interviews },
    })
  } catch (error) {
    console.error('Get candidate error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch candidate' },
      { status: 500 }
    )
  }
}

// PUT - Update candidate (profile, stage, notes, offer)
export async function PUT(request, { params }) {
  try {
    const { id } = await params
    const auth = await getAuthAndModels(request, ['Candidate', 'JobPosting', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Candidate } = models

    if (!ALLOWED_ROLES.includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Insufficient permissions' }, { status: 403 })
    }

    const data = await request.json()
    const existing = await Candidate.findById(id)
    if (!existing) {
      return NextResponse.json({ success: false, message: 'Candidate not found' }, { status: 404 })
    }

    const employeeId = user.employeeId?._id || user.employeeId

    // Handle stage change — push to stageHistory
    if (data.stage && data.stage !== existing.stage) {
      if (!existing.stageHistory) existing.stageHistory = []
      existing.stageHistory.push({
        stage: data.stage,
        movedAt: new Date(),
        movedBy: employeeId,
        notes: data.stageChangeNotes || `Moved to ${data.stage}`,
      })
      data.stageHistory = existing.stageHistory
      delete data.stageChangeNotes
    }

    // Handle adding a note
    if (data.newNote) {
      if (!existing.notes) existing.notes = []
      existing.notes.push({
        note: data.newNote,
        addedBy: employeeId,
        addedAt: new Date(),
      })
      data.notes = existing.notes
      delete data.newNote
    }

    const candidate = await Candidate.findByIdAndUpdate(id, data, { new: true, runValidators: true })
      .populate('jobPosting', 'jobTitle jobCode department status')
      .populate('referredBy', 'firstName lastName')
      .populate('createdBy', 'firstName lastName')
      .populate('notes.addedBy', 'firstName lastName')
      .populate('stageHistory.movedBy', 'firstName lastName')

    try {
      await logActivity({
        employeeId,
        type: 'recruitment_candidate_update',
        action: 'Updated candidate',
        details: `Updated candidate ${candidate.firstName} ${candidate.lastName}`,
        metadata: { candidateId: id, changes: Object.keys(data) },
        relatedModel: 'Candidate',
        relatedId: id,
      })
    } catch (e) {
      console.error('Activity log error (non-critical):', e)
    }

    // Emit stage change event if stage changed
    if (data.stage && data.stage !== existing.stage) {
      emitCandidateStageChanged(
        candidate.toObject ? candidate.toObject() : candidate,
        { action: 'stage-change' }
      )
    } else {
      emitRecruitmentUpdate(
        candidate.toObject ? candidate.toObject() : candidate,
        { action: 'candidate-update' }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Candidate updated successfully',
      data: candidate,
    })
  } catch (error) {
    console.error('Update candidate error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update candidate' },
      { status: 500 }
    )
  }
}

// DELETE - Delete candidate
export async function DELETE(request, { params }) {
  try {
    const { id } = await params
    const auth = await getAuthAndModels(request, ['Candidate', 'Interview'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Candidate, Interview } = models

    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Insufficient permissions' }, { status: 403 })
    }

    const candidate = await Candidate.findById(id)
    if (!candidate) {
      return NextResponse.json({ success: false, message: 'Candidate not found' }, { status: 404 })
    }

    // Delete related interviews
    await Interview.deleteMany({ candidate: id })
    await Candidate.findByIdAndDelete(id)

    return NextResponse.json({ success: true, message: 'Candidate deleted successfully' })
  } catch (error) {
    console.error('Delete candidate error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete candidate' },
      { status: 500 }
    )
  }
}
