import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import mongoose from 'mongoose';
import { canViewUserScreenshots } from '@/lib/productivityPermissions';
import { getTodayDateString } from '@/lib/timezone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/productivity/daily?date=YYYY-MM-DD&userId=
 * Returns the day's screenshots (analyzed + pending) and the persisted
 * daily AI analysis (if any) for the requested user.
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, [
      'User',
      'Employee',
      'Department',
      'Screenshot',
      'ScreenshotAnalysis',
      'ScreenshotComposite',
    ]);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, models } = auth;
    const { User, Screenshot, ScreenshotAnalysis, ScreenshotComposite } = models;

    const viewerId = user._id || user.userId;
    const viewerRole = user.role;
    if (!viewerId) {
      return NextResponse.json({ success: false, error: 'User ID not found' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || getTodayDateString();
    const targetUserId = searchParams.get('userId') || viewerId.toString();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ success: false, error: 'Invalid date format (expected YYYY-MM-DD)' }, { status: 400 });
    }

    if (targetUserId.toString() !== viewerId.toString() && !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return NextResponse.json({ success: false, error: 'Invalid user ID' }, { status: 400 });
    }

    if (targetUserId.toString() !== viewerId.toString()) {
      const exists = await User.findById(targetUserId).select('_id');
      if (!exists) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
      }
    }

    const canView = await canViewUserScreenshots(viewerId, targetUserId, viewerRole, models);
    if (!canView) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const screenshots = await Screenshot.find({ user: targetUserId, dateString: date })
      .sort({ capturedAt: 1 })
      .select('_id capturedAt activity analyzed analyzedAt metadata.mimeType')
      .lean();

    const formatted = screenshots.map((s) => ({
      id: s._id.toString(),
      capturedAt: s.capturedAt,
      formattedTime: new Date(s.capturedAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }),
      activity: s.activity || null,
      analyzed: !!s.analyzed,
      analyzedAt: s.analyzedAt || null,
      mimeType: s.metadata?.mimeType || 'image/webp',
      imageUrl: `/api/activity/screenshot?id=${s._id}`,
    }));

    const pendingCount = formatted.filter((s) => !s.analyzed).length;
    const livingAnalyzedCount = formatted.length - pendingCount;

    // Analyzed screenshots are folded into the per-day composite and the
    // originals are deleted, so they no longer appear in `formatted`. Pull
    // the persisted tile count from the composite so the stats card stays
    // accurate across days.
    let compositeTileCount = 0;
    try {
      const compositeDoc = await ScreenshotComposite.findOne({
        user: targetUserId,
        dateString: date,
      }).select('tileCount').lean();
      compositeTileCount = compositeDoc?.tileCount || 0;
    } catch (err) {
      console.warn('[Productivity/Daily] Failed to load composite count:', err.message);
    }

    const analyzedCount = livingAnalyzedCount + compositeTileCount;

    let analysisDoc = null;
    try {
      analysisDoc = await ScreenshotAnalysis.findOne({
        user: targetUserId,
        dateString: date,
      }).lean();
    } catch (err) {
      console.warn('[Productivity/Daily] Failed to load analysis doc:', err.message);
    }

    const targetUser = await User.findById(targetUserId).select('name email');

    return NextResponse.json({
      success: true,
      date,
      user: targetUser
        ? { id: targetUser._id.toString(), name: targetUser.name, email: targetUser.email }
        : null,
      stats: {
        total: formatted.length + compositeTileCount,
        analyzed: analyzedCount,
        pending: pendingCount,
        compositeTiles: compositeTileCount,
      },
      screenshots: formatted,
      analysis: analysisDoc
        ? {
            id: analysisDoc._id.toString(),
            updatedAt: analysisDoc.updatedAt || analysisDoc.lastAnalyzedAt || null,
            lastAnalyzedAt: analysisDoc.lastAnalyzedAt || null,
            analyzedScreenshotIds: (analysisDoc.analyzedScreenshotIds || []).map((id) => id.toString()),
            aiAnalysis: analysisDoc.aiAnalysis || null,
          }
        : null,
    });
  } catch (error) {
    console.error('[Productivity/Daily] Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load daily productivity' }, { status: 500 });
  }
}
