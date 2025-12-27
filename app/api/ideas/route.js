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

    // Build query
    let query = { type: 'idea' };

    // Filter by user's ideas
    if (tab === 'my') {
      query.submittedBy = employeeId;
    }

    // Search
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'tags': { $regex: search, $options: 'i' } }
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

    // Filter pinned
    if (pinned) {
      query.isPinned = true;
    }

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
      .sort({ isPinned: -1, createdAt: -1 })
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
    const formattedIdeas = ideas.map(idea => {
      const userVote = employeeId 
        ? idea.votes?.find(v => v.voter?.toString() === employeeId.toString())?.type || null
        : null;
      
      return {
        _id: idea._id,
        title: idea.title,
        description: idea.description,
        summary: idea.summary,
        category: idea.category,
        status: idea.status,
        priority: idea.priority,
        isAnonymous: idea.isAnonymous,
        isPinned: idea.isPinned || false,
        author: idea.isAnonymous ? null : {
          _id: idea.submittedBy?._id,
          name: `${idea.submittedBy?.firstName || ''} ${idea.submittedBy?.lastName || ''}`.trim() || 'Unknown',
          profilePicture: idea.submittedBy?.profilePicture,
          department: idea.submittedBy?.department?.name || 'Unknown'
        },
        likes: idea.votes?.filter(v => v.type === 'upvote').length || 0,
        dislikes: idea.votes?.filter(v => v.type === 'downvote').length || 0,
        userVote,
        commentsCount: idea.comments?.length || 0,
        tags: idea.tags || [],
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
    const auth = await getAuthAndModels(request, ['Suggestion', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Suggestion, User } = models

    // Get user to find employeeId
    const currentUser = await User.findById(user._id || user.userId).select('employeeId');
    if (!currentUser || !currentUser.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee profile not found' }, { status: 404 });
    }

    const body = await request.json();
    const { title, description, category, isAnonymous, tags, aiExpanded } = body;

    if (!title || !description) {
      return NextResponse.json(
        { success: false, message: 'Title and description are required' },
        { status: 400 }
      );
    }

    // Create idea using Suggestion model
    const idea = new Suggestion({
      title: title.trim(),
      description: description.trim(),
      summary: description.substring(0, 200),
      category: category || 'other',
      type: 'idea',
      submittedBy: currentUser.employeeId,
      isAnonymous: isAnonymous || false,
      status: 'submitted',
      priority: 'medium',
      tags: tags || [],
      aiExpanded: aiExpanded || false,
      votes: [],
      comments: []
    });

    await idea.save();

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
          name: `${idea.submittedBy?.firstName} ${idea.submittedBy?.lastName}`,
          profilePicture: idea.submittedBy?.profilePicture,
          department: idea.submittedBy?.department?.name
        },
        createdAt: idea.createdAt
      }
    });

  } catch (error) {
    console.error('[Ideas] POST error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to create idea', error: error.message },
      { status: 500 }
    );
  }
}
