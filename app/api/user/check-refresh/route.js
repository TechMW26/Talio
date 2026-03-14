import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

/**
 * GET /api/user/check-refresh
 * Check if there are any pending force-refresh commands for the current user.
 * Used as a polling fallback when Socket.IO is unavailable.
 * Marks consumed refreshes so they aren't returned again.
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['ForceRefresh']);
    if (!auth.success) {
      return NextResponse.json({ pending: false }, { status: 200 });
    }

    const { user, models } = auth;
    const { ForceRefresh } = models;
    const userId = user._id?.toString() || user.userId;

    // Find unconsumed refresh commands created in the last 2 minutes
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const pendingRefresh = await ForceRefresh.findOneAndUpdate(
      {
        userId,
        consumed: false,
        createdAt: { $gte: twoMinutesAgo },
      },
      { $set: { consumed: true } },
      { sort: { createdAt: -1 } }
    ).lean();

    if (pendingRefresh) {
      return NextResponse.json({
        pending: true,
        message: pendingRefresh.message,
        hard: pendingRefresh.hard,
        initiatedBy: pendingRefresh.initiatedBy,
        timestamp: pendingRefresh.createdAt,
      });
    }

    return NextResponse.json({ pending: false });
  } catch (error) {
    console.error('[Check Refresh] Error:', error.message);
    return NextResponse.json({ pending: false });
  }
}
