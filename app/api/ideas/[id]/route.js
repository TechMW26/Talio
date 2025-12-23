import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Suggestion from '@/models/Suggestion';
import User from '@/models/User';
import { verifyToken } from '@/lib/auth';

/**
 * GET /api/ideas/[id]
 * Get a single idea by ID
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
        path: 'submittedBy',
        select: 'firstName lastName profilePicture department',
        populate: { path: 'department', select: 'name' }
      })
      .populate({
        path: 'comments.author',
        select: 'firstName lastName profilePicture'
      })
      .lean();

    if (!idea) {
      return NextResponse.json({ success: false, message: 'Idea not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: idea
    });

  } catch (error) {
    console.error('[Ideas] GET by ID error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch idea', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/ideas/[id]
 * Update an idea (owner only can update content, admin can update status/pin)
 */
export async function PUT(request, { params }) {
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

    // Get employeeId and role from User
    const currentUser = await User.findById(decoded.userId).select('employeeId role');
    if (!currentUser) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }
    const employeeId = currentUser.employeeId?.toString();
    const userRole = currentUser.role;

    const { id } = await params;
    const body = await request.json();
    const { action, title, description, category, isAnonymous, status, tags } = body;

    const idea = await Suggestion.findById(id);
    if (!idea) {
      return NextResponse.json({ success: false, message: 'Idea not found' }, { status: 404 });
    }

    const isOwner = idea.submittedBy?.toString() === employeeId;
    const isAdmin = userRole === 'admin' || userRole === 'hr' || userRole === 'department_head';

    // Handle pin action
    if (action === 'pin') {
      if (!isAdmin) {
        return NextResponse.json({ success: false, message: 'Only admins can pin ideas' }, { status: 403 });
      }
      idea.isPinned = !idea.isPinned;
      await idea.save();
      return NextResponse.json({
        success: true,
        message: idea.isPinned ? 'Idea pinned' : 'Idea unpinned',
        data: { isPinned: idea.isPinned }
      });
    }

    // Handle toggle anonymous action
    if (action === 'toggleAnonymous') {
      if (!isOwner) {
        return NextResponse.json({ success: false, message: 'Only owner can change anonymity' }, { status: 403 });
      }
      idea.isAnonymous = !idea.isAnonymous;
      await idea.save();
      return NextResponse.json({
        success: true,
        message: idea.isAnonymous ? 'Now anonymous' : 'No longer anonymous',
        data: { isAnonymous: idea.isAnonymous }
      });
    }

    // Owner can update content
    if (isOwner) {
      if (title) idea.title = title.trim();
      if (description) idea.description = description.trim();
      if (category) idea.category = category;
      if (typeof isAnonymous === 'boolean') idea.isAnonymous = isAnonymous;
      if (tags) idea.tags = tags;
    }

    // Admin can update status
    if (isAdmin && status) {
      idea.status = status;
    }

    if (!isOwner && !isAdmin) {
      return NextResponse.json({ success: false, message: 'Not authorized to update this idea' }, { status: 403 });
    }

    await idea.save();

    return NextResponse.json({
      success: true,
      message: 'Idea updated successfully',
      data: idea
    });

  } catch (error) {
    console.error('[Ideas] PUT error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update idea', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/ideas/[id]
 * Delete an idea (owner or admin only)
 */
export async function DELETE(request, { params }) {
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

    // Get employeeId and role from User
    const currentUser = await User.findById(decoded.userId).select('employeeId role');
    if (!currentUser) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }
    const employeeId = currentUser.employeeId?.toString();
    const userRole = currentUser.role;

    const { id } = await params;

    const idea = await Suggestion.findById(id);
    if (!idea) {
      return NextResponse.json({ success: false, message: 'Idea not found' }, { status: 404 });
    }

    const isOwner = idea.submittedBy?.toString() === employeeId;
    const isAdmin = userRole === 'admin' || userRole === 'hr';

    if (!isOwner && !isAdmin) {
      return NextResponse.json({ success: false, message: 'Not authorized to delete this idea' }, { status: 403 });
    }

    await Suggestion.findByIdAndDelete(id);

    return NextResponse.json({
      success: true,
      message: 'Idea deleted successfully'
    });

  } catch (error) {
    console.error('[Ideas] DELETE error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete idea', error: error.message },
      { status: 500 }
    );
  }
}
