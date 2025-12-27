import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

/**
 * POST /api/ideas/[id]/vote
 * Vote on an idea (upvote/downvote)
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
    const employeeId = currentUser.employeeId.toString();

    const { id } = await params;
    const body = await request.json();
    const { type } = body; // 'upvote' or 'downvote' or 'remove'

    const idea = await Suggestion.findById(id);
    if (!idea) {
      return NextResponse.json({ success: false, message: 'Idea not found' }, { status: 404 });
    }

    // Initialize votes array if not exists
    if (!idea.votes) {
      idea.votes = [];
    }

    // Find existing vote
    const existingVoteIndex = idea.votes.findIndex(
      v => v.voter?.toString() === employeeId
    );

    if (type === 'remove') {
      // Remove vote
      if (existingVoteIndex > -1) {
        idea.votes.splice(existingVoteIndex, 1);
      }
    } else if (existingVoteIndex > -1) {
      // Update existing vote
      idea.votes[existingVoteIndex].type = type;
      idea.votes[existingVoteIndex].votedAt = new Date();
    } else {
      // Add new vote
      idea.votes.push({
        voter: currentUser.employeeId,
        type,
        votedAt: new Date()
      });
    }

    await idea.save();

    const likes = idea.votes.filter(v => v.type === 'upvote').length;
    const dislikes = idea.votes.filter(v => v.type === 'downvote').length;
    const userVote = idea.votes.find(v => v.voter?.toString() === employeeId)?.type || null;

    return NextResponse.json({
      success: true,
      data: {
        likes,
        dislikes,
        userVote
      }
    });

  } catch (error) {
    console.error('[Ideas] Vote error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to vote', error: error.message },
      { status: 500 }
    );
  }
}
