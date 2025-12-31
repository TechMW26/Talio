import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

/**
 * GET /api/ideas/[id]/comments
 * Get all comments for an idea
 */
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Suggestion', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Suggestion } = models

    const { id } = await params;

    const idea = await Suggestion.findById(id)
      .populate({
        path: 'comments.author',
        select: 'firstName lastName profilePicture department',
        populate: { path: 'department', select: 'name' }
      })
      .lean();

    if (!idea) {
      return NextResponse.json({ success: false, message: 'Idea not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: idea.comments || []
    });

  } catch (error) {
    console.error('[Ideas] Get comments error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to get comments', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ideas/[id]/comments
 * Add a comment to an idea
 */
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Suggestion', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Suggestion, User } = models

    // Get employeeId from User
    const currentUser = await User.findById(user._id || user.userId).select('employeeId');
    if (!currentUser || !currentUser.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 });
    }

    const { id } = await params;
    const body = await request.json();
    const { content } = body;

    if (!content?.trim()) {
      return NextResponse.json(
        { success: false, message: 'Comment content is required' },
        { status: 400 }
      );
    }

    const idea = await Suggestion.findById(id);
    if (!idea) {
      return NextResponse.json({ success: false, message: 'Idea not found' }, { status: 404 });
    }

    // Initialize comments array if not exists
    if (!idea.comments) {
      idea.comments = [];
    }

    // Schema: comments: [{ content: String, author: ObjectId, createdAt: Date }]
    // Note: isAnonymous is NOT in the schema
    const newComment = {
      author: currentUser.employeeId,
      content: content.trim(),
      createdAt: new Date()
    };

    idea.comments.push(newComment);
    await idea.save();

    // Populate the comment author for response
    await idea.populate({
      path: 'comments.author',
      select: 'firstName lastName profilePicture department',
      populate: { path: 'department', select: 'name' }
    });

    const addedComment = idea.comments[idea.comments.length - 1];

    return NextResponse.json({
      success: true,
      data: addedComment,
      commentsCount: idea.comments.length
    });

  } catch (error) {
    console.error('[Ideas] Add comment error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to add comment', error: error.message },
      { status: 500 }
    );
  }
}
