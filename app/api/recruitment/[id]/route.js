import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { emitRecruitmentUpdate } from '@/lib/realtimeEvents';

// GET - Get single job posting with candidate pipeline stats
export async function GET(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Recruitment', 'Candidate']);
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
    }
    const { models } = auth;
    const { Recruitment, Candidate } = models;

    const job = await Recruitment.findById(params.id)
      .populate('department', 'name')
      .populate('designation', 'title')
      .populate('hiringManager', 'firstName lastName email')
      .populate('recruiters', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName')
      .lean();

    if (!job) {
      return NextResponse.json(
        { success: false, message: 'Job posting not found' },
        { status: 404 }
      );
    }

    // Get candidate pipeline stats for this job
    const candidateStats = await Candidate.aggregate([
      { $match: { jobPosting: job._id } },
      { $group: { _id: '$stage', count: { $sum: 1 } } },
    ]);

    const totalCandidates = candidateStats.reduce((sum, s) => sum + s.count, 0);
    const pipeline = Object.fromEntries(candidateStats.map((s) => [s._id, s.count]));

    // Get recent candidates
    const recentCandidates = await Candidate.find({ jobPosting: job._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('firstName lastName email stage rating source createdAt')
      .lean();

    return NextResponse.json({
      success: true,
      data: {
        ...job,
        candidateCount: totalCandidates,
        pipeline,
        recentCandidates,
      },
    });
  } catch (error) {
    console.error('Get job error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch job posting' },
      { status: 500 }
    );
  }
}

// PUT - Update job posting
export async function PUT(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Recruitment']);
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { Recruitment } = models;

    // Role check
    if (!['admin', 'hr', 'manager'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Not authorized to update job postings' },
        { status: 403 }
      );
    }

    const data = await request.json();

    // Handle publish action
    if (data.status === 'open' && !data.publishedAt) {
      data.publishedAt = new Date();
    }

    // Handle close action
    if (data.status === 'closed' && !data.closedAt) {
      data.closedAt = new Date();
    }

    const job = await Recruitment.findByIdAndUpdate(
      params.id,
      { $set: data },
      { new: true, runValidators: true }
    )
      .populate('department', 'name')
      .populate('designation', 'title')
      .populate('hiringManager', 'firstName lastName email')
      .populate('recruiters', 'firstName lastName email');

    if (!job) {
      return NextResponse.json(
        { success: false, message: 'Job posting not found' },
        { status: 404 }
      );
    }

    emitRecruitmentUpdate(job.toObject ? job.toObject() : job, { action: 'update' });

    return NextResponse.json({
      success: true,
      message: 'Job posting updated successfully',
      data: job,
    });
  } catch (error) {
    console.error('Update job error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update job posting' },
      { status: 500 }
    );
  }
}

// DELETE - Delete job posting (with cascade cleanup)
export async function DELETE(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Recruitment', 'Candidate', 'Interview']);
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { Recruitment, Candidate, Interview } = models;

    // Role check
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Not authorized to delete job postings' },
        { status: 403 }
      );
    }

    const job = await Recruitment.findById(params.id);
    if (!job) {
      return NextResponse.json(
        { success: false, message: 'Job posting not found' },
        { status: 404 }
      );
    }

    // Cascade: remove related candidates and interviews
    const candidates = await Candidate.find({ jobPosting: params.id }).select('_id');
    const candidateIds = candidates.map((c) => c._id);

    if (candidateIds.length > 0) {
      await Interview.deleteMany({ candidate: { $in: candidateIds } });
    }
    await Candidate.deleteMany({ jobPosting: params.id });
    await Recruitment.findByIdAndDelete(params.id);

    emitRecruitmentUpdate({ _id: params.id }, { action: 'delete' });

    return NextResponse.json({
      success: true,
      message: 'Job posting and related data deleted successfully',
    });
  } catch (error) {
    console.error('Delete job error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete job posting' },
      { status: 500 }
    );
  }
}

