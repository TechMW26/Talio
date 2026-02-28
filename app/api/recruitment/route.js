import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { emitRecruitmentUpdate } from '@/lib/realtimeEvents';

// GET - List job postings with search, filters & pagination
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['Recruitment', 'Candidate']);
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { Recruitment, Candidate } = models;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const status = searchParams.get('status');
    const department = searchParams.get('department');
    const employmentType = searchParams.get('employmentType');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 1 : -1;

    const query = {};

    if (search) {
      query.$or = [
        { jobTitle: { $regex: search, $options: 'i' } },
        { jobCode: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } },
      ];
    }
    if (status) query.status = status;
    if (department) query.department = department;
    if (employmentType) query.employmentType = employmentType;

    const [jobs, total] = await Promise.all([
      Recruitment.find(query)
        .populate('department', 'name')
        .populate('hiringManager', 'firstName lastName')
        .sort({ [sortBy]: sortOrder })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Recruitment.countDocuments(query),
    ]);

    // Attach candidate count to each job
    const jobIds = jobs.map((j) => j._id);
    const candidateCounts = await Candidate.aggregate([
      { $match: { jobPosting: { $in: jobIds } } },
      { $group: { _id: '$jobPosting', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(candidateCounts.map((c) => [c._id.toString(), c.count]));

    const enrichedJobs = jobs.map((job) => ({
      ...job,
      candidateCount: countMap[job._id.toString()] || 0,
    }));

    return NextResponse.json({
      success: true,
      data: enrichedJobs,
      pagination: {
        total,
        pages: Math.ceil(total / limit),
        page,
        limit,
      },
    });
  } catch (error) {
    console.error('Get recruitment error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch job postings' },
      { status: 500 }
    );
  }
}

// POST - Create job posting
export async function POST(request) {
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
        { success: false, message: 'Not authorized to create job postings' },
        { status: 403 }
      );
    }

    const data = await request.json();

    // Auto-generate jobCode if not provided
    if (!data.jobCode) {
      const count = await Recruitment.countDocuments();
      data.jobCode = `JOB-${String(count + 1).padStart(4, '0')}`;
    }

    // Set creator
    data.createdBy = user.employeeId || user._id;

    // Set publishedAt if status is open
    if (data.status === 'open') {
      data.publishedAt = new Date();
    }

    const job = await Recruitment.create(data);

    const populatedJob = await Recruitment.findById(job._id)
      .populate('department', 'name')
      .populate('hiringManager', 'firstName lastName')
      .lean();

    emitRecruitmentUpdate(populatedJob, { action: 'create' });

    return NextResponse.json(
      {
        success: true,
        message: 'Job posting created successfully',
        data: populatedJob,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create recruitment error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create job posting' },
      { status: 500 }
    );
  }
}

