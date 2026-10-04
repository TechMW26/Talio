import { NextResponse } from 'next/server';
import { getProductivityViewStore } from '@/lib/platform/firestoreProductivityView.server';
import { verifyTokenFromRequest } from '@/lib/auth';
import { canViewTenantScreenshots } from '@/lib/productivityPermissions';
import {
  runDailyAnalysis,
} from '@/lib/dailyAnalysisRunner';
import { getDateKeyInTimezone, getStartOfDayInTimezone, IST_TIMEZONE } from '@/lib/timezone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

function mapAnalysisDoc(doc) {
  const ai = doc?.aiAnalysis || {};
  return {
    id: doc._id.toString(),
    dateString: doc.dateString,
    formattedDate: doc.date
      ? new Date(doc.date).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : doc.dateString,
    status: doc.status || 'completed',
    screenshotCount: doc.screenshotCount || doc.analyzedScreenshotIds?.length || 0,
    totalActiveMinutes: doc.totalActiveMinutes || null,
    workDuration: doc.totalActiveMinutes
      ? `${Math.floor(doc.totalActiveMinutes / 60)}h ${doc.totalActiveMinutes % 60}m`
      : null,
    firstCapture: doc.firstCapture || null,
    lastCapture: doc.lastCapture || null,
    employeeContext: doc.employeeContext || null,
    timeline: doc.timeline || [],
    summary: ai.summary || doc.summary || null,
    metrics: doc.metrics || {
      score: ai.score ?? null,
      focusScore: ai.focusScore ?? null,
      taskCompletionIndicators: ai.taskCompletionIndicators ?? null,
      timeDistribution: ai.timeDistribution || null,
    },
    applicationUsage: ai.applications || doc.applicationUsage || [],
    categoryBreakdown: ai.workCategories || doc.categoryBreakdown || [],
    hourlyActivity: doc.hourlyActivity || [],
    analyzedAt: doc.lastAnalyzedAt || doc.analyzedAt || null,
    aiModel: doc.provider || doc.aiModel || null,
    error: doc.error || null,
    aiAnalysis: ai,
  };
}

/**
 * GET /api/activity/analysis
 * Legacy compatibility endpoint. Reads the SAME ScreenshotAnalysis documents
 * produced by the current /api/productivity/daily pipeline.
 */
export async function GET(request) {
  try {
    const auth = await verifyTokenFromRequest(request);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, tenant } = auth;
    const store = await getProductivityViewStore(tenant.databaseName);

    const viewerId = user._id || user.userId;
    const viewerRole = user.role;
    if (!viewerId) {
      return NextResponse.json({ success: false, error: 'User ID not found' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const targetUserId = (searchParams.get('userId') || viewerId).toString();
    const date = searchParams.get('date');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (targetUserId !== viewerId.toString() && !/^[a-f\d]{24}$/i.test(String(targetUserId))) {
      return NextResponse.json({ success: false, error: 'Invalid user ID format' }, { status: 400 });
    }

    if (targetUserId !== viewerId.toString()) {
      const exists = await store.get('users', String(targetUserId));
      if (!exists) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
      }
    }

    const canView = await canViewTenantScreenshots(viewerId, targetUserId, viewerRole, tenant.databaseName);
    if (!canView) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const query = { user: targetUserId };
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ success: false, error: 'Invalid date format (expected YYYY-MM-DD)' }, { status: 400 });
      }
      query.dateString = date;
    } else if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(`${endDate}T23:59:59.999Z`),
      };
    } else if (startDate) {
      query.date = { $gte: new Date(startDate) };
    } else if (endDate) {
      query.date = { $lte: new Date(`${endDate}T23:59:59.999Z`) };
    } else {
      const todayStart = getStartOfDayInTimezone(new Date(), IST_TIMEZONE);
      query.dateString = getDateKeyInTimezone(new Date(todayStart.getTime() - 1), IST_TIMEZONE);
    }

    const filters = [{ field: 'user', operator: '==', value: targetUserId }];
    if (query.dateString) filters.push({ field: 'dateString', operator: '==', value: query.dateString });
    for (const [operator, value] of [['>=', query.date?.$gte], ['<=', query.date?.$lte]]) {
      if (value) { if (!Number.isFinite(value.getTime())) return NextResponse.json({ error: 'Invalid date range' }, { status: 400 }); filters.push({ field: 'date', operator, value }); }
    }
    const analyses = (await store.list('screenshotanalyses', { filters, orderBy: [{ field: 'date', direction: 'desc' }], limit: 30 })).records;

    const targetUser = await store.get('users', String(targetUserId));

    return NextResponse.json({
      success: true,
      analyses: analyses.map(mapAnalysisDoc),
      user: targetUser
        ? {
            id: targetUser._id.toString(),
            name: targetUser.name,
            email: targetUser.email,
          }
        : null,
      compatibilityMode: 'productivity-daily',
    });
  } catch (error) {
    console.error('[Activity/Analysis] GET error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/activity/analysis
 * Legacy compatibility endpoint. Writes through the SAME stitch -> composite
 * -> single AI call pipeline used by /api/productivity/daily/analyze.
 */
export async function POST(request) {
  try {
    const auth = await verifyTokenFromRequest(request);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, tenant } = auth;
    const viewerId = user._id || user.userId;
    const viewerRole = user.role;
    if (!viewerId) {
      return NextResponse.json({ success: false, error: 'User ID not found' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const targetUserId = (body.userId || viewerId).toString();
    const dateString = body.date;

    if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      return NextResponse.json({ success: false, error: 'Date is required (YYYY-MM-DD)' }, { status: 400 });
    }
    if (targetUserId !== viewerId.toString() && !/^[a-f\d]{24}$/i.test(String(targetUserId))) {
      return NextResponse.json({ success: false, error: 'Invalid userId' }, { status: 400 });
    }

    const canView = await canViewTenantScreenshots(viewerId, targetUserId, viewerRole, tenant.databaseName);
    if (!canView) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const result = await runDailyAnalysis({
      userId: targetUserId,
      dateString,
      tenant,
      trigger: 'manual-legacy',
      forceReanalyze: true,
    });

    if (result.status === 'empty') {
      return NextResponse.json({
        success: true,
        message: result.message,
        analysis: null,
        pendingCount: 0,
        stitched: 0,
        compatibilityMode: 'productivity-daily',
      });
    }

    if (result.status === 'no-composite') {
      return NextResponse.json(
        { success: false, error: result.message, ...result, compatibilityMode: 'productivity-daily' },
        { status: 500 },
      );
    }

    if (result.status === 'ai-failed') {
      return NextResponse.json(
        { success: false, error: result.error, ...result, compatibilityMode: 'productivity-daily' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message || `Analysis refreshed for ${dateString}.`,
      pendingCount: result.pendingCount || 0,
      stitched: result.stitched || 0,
      analysis: result.analysis || null,
      compatibilityMode: 'productivity-daily',
    });
  } catch (error) {
    console.error('[Activity/Analysis] POST error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
