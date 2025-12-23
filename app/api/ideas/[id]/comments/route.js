import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Suggestion from '@/models/Suggestion';
import User from '@/models/User';
import { verifyToken } from '@/lib/auth';

/**
 * GET /api/ideas/[id]/comments
 * Get all comments for an idea
 */
export async function GET(request, { params }) {
  try {
    await connectDB();

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const decoded = await verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 });
    }

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
    await connectDB();

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const decoded = await verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 });
    }

    // Get employeeId from User
    const currentUser = await User.findById(decoded.userId).select('employeeId');
    if (!currentUser || !currentUser.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 });
    }

    const { id } = await params;
    const body = await request.json();
    const { content, isAnonymous = false } = body;

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

    const newComment = {
      author: currentUser.employeeId,
      content: content.trim(),
      isAnonymous,
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
      data: addedComment
    });

  } catch (error) {
    console.error('[Ideas] Add comment error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to add comment', error: error.message },
      { status: 500 }
    );
  }
}
