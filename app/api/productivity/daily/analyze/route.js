import { NextResponse } from 'next/server';
import { verifyTokenFromRequest } from '@/lib/auth';
import { canViewTenantScreenshots } from '@/lib/productivityPermissions';
import {
  runDailyAnalysis,
} from '@/lib/dailyAnalysisRunner';
import { getTodayDateString } from '@/lib/timezone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/productivity/daily/analyze
 * Body: { date: 'YYYY-MM-DD', userId?: string }
 *
 * Stitches every pending Screenshot for the (user, day) into the per-day
 * composite, deletes the originals, then sends the composite to the AI in a
 * SINGLE vision call (with the previous analysis summary as continuity
 * context). Replaces the existing ScreenshotAnalysis with the fresh result.
 */
export async function POST(request) {
  try {
    const auth = await verifyTokenFromRequest(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, error: auth.message || 'Authentication failed' },
        { status: 401 }
      );
    }

    const { user, tenant } = auth;
    const viewerId = user._id || user.userId;
    const viewerRole = user.role;
    if (!viewerId) {
      return NextResponse.json({ success: false, error: 'User ID not found' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const date = body.date || getTodayDateString();
    const targetUserId = (body.userId || viewerId).toString();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ success: false, error: 'Invalid date (expected YYYY-MM-DD)' }, { status: 400 });
    }
    if (!/^[a-f\d]{24}$/i.test(targetUserId)) {
      return NextResponse.json({ success: false, error: 'Invalid userId' }, { status: 400 });
    }

    const canView = await canViewTenantScreenshots(viewerId, targetUserId, viewerRole, tenant.databaseName);
    if (!canView) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const result = await runDailyAnalysis({
      userId: targetUserId,
      dateString: date,
      tenant,
      trigger: 'manual',
      forceReanalyze: true,
    });

    if (result.status === 'empty') {
      return NextResponse.json({
        success: true,
        message: result.message,
        analysis: null,
        pendingCount: 0,
        stitched: 0,
      });
    }

    if (result.status === 'noop') {
      return NextResponse.json({
        success: true,
        message: 'Re-analysis skipped because no composite exists to reprocess.',
        analysis: result.analysis,
        pendingCount: 0,
        stitched: 0,
      });
    }

    if (result.status === 'no-composite') {
      return NextResponse.json(
        { success: false, error: result.message, ...result },
        { status: 500 },
      );
    }

    if (result.status === 'ai-failed') {
      return NextResponse.json(
        { success: false, error: result.error, ...result },
        { status: 502 },
      );
    }

    // status === 'analyzed'
    return NextResponse.json({
      success: true,
      message: `Analyzed day ${date}: stitched ${result.stitched} new screenshot(s) and refreshed analysis.`,
      pendingCount: result.pendingCount,
      composite: {
        stitched: result.stitched,
        purgedScreenshots: result.purgedScreenshots,
        purgedGridfsBlobs: result.purgedGridfsBlobs,
      },
      analysis: result.analysis,
    });
  } catch (error) {
    console.error('[Productivity/Daily/Analyze] Error:', {
      message: error?.message,
      cause: error?.cause,
      status: error?.status,
      code: error?.code,
      stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to analyze screenshots' },
      { status: error?.status || 500 },
    );
  }
}
