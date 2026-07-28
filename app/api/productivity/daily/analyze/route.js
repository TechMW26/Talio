import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import mongoose from 'mongoose';
import { canViewUserScreenshots } from '@/lib/productivityPermissions';
import {
  runDailyAnalysis,
  DAILY_ANALYSIS_REQUIRED_MODELS,
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
    const auth = await getAuthAndModels(request, DAILY_ANALYSIS_REQUIRED_MODELS);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, error: auth.message || 'Authentication failed' },
        { status: 401 }
      );
    }

    const { user, models, tenant } = auth;
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
    if (targetUserId !== viewerId.toString() && !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return NextResponse.json({ success: false, error: 'Invalid userId' }, { status: 400 });
    }

    const canView = await canViewUserScreenshots(viewerId, targetUserId, viewerRole, models);
    if (!canView) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const result = await runDailyAnalysis({
      userId: targetUserId,
      dateString: date,
      models,
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
