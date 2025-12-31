import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

/**
 * POST /api/ideas/[id]/vote
 * Vote on an idea (upvote/downvote)
 * Schema uses: votes: [{ employee: ObjectId, vote: Number (1 or -1), votedAt: Date }]
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

    // Find existing vote - schema uses 'employee' field (not 'voter')
    const existingVoteIndex = idea.votes.findIndex(
      v => v.employee?.toString() === employeeId
    );

    // Convert type to vote number: 'upvote' -> 1, 'downvote' -> -1
    const voteValue = type === 'upvote' ? 1 : type === 'downvote' ? -1 : null;

    if (type === 'remove') {
      // Remove vote
      if (existingVoteIndex > -1) {
        idea.votes.splice(existingVoteIndex, 1);
      }
    } else if (existingVoteIndex > -1) {
      // Update existing vote - schema uses 'vote' field (not 'type')
      idea.votes[existingVoteIndex].vote = voteValue;
      idea.votes[existingVoteIndex].votedAt = new Date();
    } else {
      // Add new vote - schema uses 'employee' and 'vote' fields
      idea.votes.push({
        employee: currentUser.employeeId,
        vote: voteValue,
        votedAt: new Date()
      });
    }

    // Update voteCount (sum of all votes: upvotes - downvotes)
    idea.voteCount = idea.votes.reduce((sum, v) => sum + (v.vote || 0), 0);

    await idea.save();

    // Calculate likes and dislikes for response
    const likes = idea.votes.filter(v => v.vote === 1).length;
    const dislikes = idea.votes.filter(v => v.vote === -1).length;

    // Find user's current vote
    const currentVote = idea.votes.find(v => v.employee?.toString() === employeeId);
    const userVote = currentVote ? (currentVote.vote === 1 ? 'upvote' : 'downvote') : null;

    return NextResponse.json({
      success: true,
      data: {
        likes,
        dislikes,
        userVote,
        voteCount: idea.voteCount
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
