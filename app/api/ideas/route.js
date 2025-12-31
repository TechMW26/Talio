import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

/**
 * GET /api/ideas
 * Get ideas with filtering, search, and pagination
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Suggestion', 'Employee', 'Department', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Suggestion, Employee, Department, User } = models

    // Get user to find employeeId
    const currentUser = await User.findById(user._id || user.userId).select('employeeId role');
    if (!currentUser) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }
    const employeeId = currentUser.employeeId;

    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'all'; // 'all' or 'my'
    const search = searchParams.get('search') || '';
    const department = searchParams.get('department') || '';
    const status = searchParams.get('status') || '';
    const pinned = searchParams.get('pinned') === 'true';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    // Build query - Suggestion schema doesn't have 'type' field, all are ideas
    let query = {};

    // Filter by user's ideas
    if (tab === 'my') {
      query.submittedBy = employeeId;
    }

    // Search
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by department
    if (department) {
      // Get employees from this department
      const deptEmployees = await Employee.find({
        $or: [
          { department: department },
          { departments: department }
        ]
      }).select('_id');
      const employeeIds = deptEmployees.map(e => e._id);
      query.submittedBy = { $in: employeeIds };
    }

    // Filter by status
    if (status) {
      query.status = status;
    }

    // Note: isPinned field doesn't exist in Suggestion schema - skipping pinned filter

    // Get ideas with population
    const ideas = await Suggestion.find(query)
      .populate({
        path: 'submittedBy',
        select: 'firstName lastName profilePicture department',
        populate: {
          path: 'department',
          select: 'name'
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count
    const total = await Suggestion.countDocuments(query);

    // Get departments for filter
    const departments = await Department.find({ isActive: true })
      .select('name')
      .sort({ name: 1 })
      .lean();

    // Format ideas for response
    // Note: votes structure is [{ employee, vote: 1 or -1, votedAt }]
    const formattedIdeas = ideas.map(idea => {
      // Find user's vote (vote is 1 for upvote, -1 for downvote)
      const userVoteObj = employeeId
        ? idea.votes?.find(v => v.employee?.toString() === employeeId.toString())
        : null;
      const userVote = userVoteObj ? (userVoteObj.vote === 1 ? 'upvote' : 'downvote') : null;

      return {
        _id: idea._id,
        title: idea.title,
        description: idea.description,
        category: idea.category,
        status: idea.status,
        author: {
          _id: idea.submittedBy?._id,
          name: `${idea.submittedBy?.firstName || ''} ${idea.submittedBy?.lastName || ''}`.trim() || 'Unknown',
          profilePicture: idea.submittedBy?.profilePicture,
          department: idea.submittedBy?.department?.name || 'Unknown'
        },
        likes: idea.votes?.filter(v => v.vote === 1).length || 0,
        dislikes: idea.votes?.filter(v => v.vote === -1).length || 0,
        voteCount: idea.voteCount || 0,
        userVote,
        commentsCount: idea.comments?.length || 0,
        createdAt: idea.createdAt,
        updatedAt: idea.updatedAt,
        isOwner: idea.submittedBy?._id?.toString() === employeeId?.toString()
      };
    });

    return NextResponse.json({
      success: true,
      data: formattedIdeas,
      departments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('[Ideas] GET error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch ideas', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ideas
 * Create a new idea
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Suggestion', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Suggestion, Employee, User } = models

    console.log('[Ideas POST] User data:', { userId: user.userId || user._id, employeeId: user.employeeId })

    // Get user to find employeeId
    const userId = user.userId || user._id
    const currentUser = await User.findById(userId).select('employeeId');
    if (!currentUser) {
      console.error('[Ideas POST] User not found:', userId)
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    if (!currentUser.employeeId) {
      console.error('[Ideas POST] Employee profile not found for user:', userId)
      return NextResponse.json({ success: false, message: 'Employee profile not found' }, { status: 404 });
    }

    const body = await request.json();
    const { title, description, category, isAnonymous, tags, aiExpanded } = body;

    console.log('[Ideas POST] Request body:', { title, category, isAnonymous, tagsCount: tags?.length })

    if (!title || !description) {
      return NextResponse.json(
        { success: false, message: 'Title and description are required' },
        { status: 400 }
      );
    }

    // Create idea using Suggestion model
    // Note: status enum values are: 'pending', 'under-review', 'approved', 'rejected', 'implemented'
    const idea = new Suggestion({
      title: title.trim(),
      description: description.trim(),
      category: category || 'other',
      submittedBy: currentUser.employeeId,
      status: 'pending',  // Use 'pending' not 'submitted'
      votes: [],
      voteCount: 0,
      comments: []
    });

    await idea.save();
    console.log('[Ideas POST] Idea created:', idea._id)

    // Populate for response
    await idea.populate({
      path: 'submittedBy',
      select: 'firstName lastName profilePicture department',
      populate: {
        path: 'department',
        select: 'name'
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Idea submitted successfully',
      data: {
        _id: idea._id,
        title: idea.title,
        description: idea.description,
        category: idea.category,
        status: idea.status,
        isAnonymous: idea.isAnonymous,
        author: idea.isAnonymous ? null : {
          name: `${idea.submittedBy?.firstName || ''} ${idea.submittedBy?.lastName || ''}`.trim() || 'Unknown',
          profilePicture: idea.submittedBy?.profilePicture,
          department: idea.submittedBy?.department?.name
        },
        createdAt: idea.createdAt
      }
    });

  } catch (error) {
    console.error('[Ideas] POST error:', error);
    console.error('[Ideas] POST error stack:', error.stack);
    return NextResponse.json(
      { success: false, message: 'Failed to create idea', error: error.message },
      { status: 500 }
    );
  }
}
