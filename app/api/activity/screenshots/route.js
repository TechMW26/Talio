import { NextResponse } from 'next/server';
import { verifyTokenFromRequest } from '@/lib/auth'
import { getScreenshotStore, findScreenshotComposite, listScreenshotMaintenanceRecords } from '@/lib/platform/firestoreScreenshots.server';
import { canViewTenantScreenshots } from '@/lib/productivityPermissions';

/**
 * GET /api/activity/screenshots
 * List screenshots for a user
 * 
 * Query params:
 * - userId: Target user ID (optional, defaults to current user)
 * - date: Date string YYYY-MM-DD (optional, defaults to today)
 * - startDate: Start date for range query
 * - endDate: End date for range query
 * - limit: Max results (default 100)
 * - skip: Pagination offset
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await verifyTokenFromRequest(request)
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, tenant } = auth;
    const store = await getScreenshotStore(tenant.databaseName);

    const viewerId = user._id || user.userId;
    const viewerRole = user.role;

    if (!viewerId) {
      return NextResponse.json({ success: false, error: 'User ID not found' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
  const targetUserId = searchParams.get('userId') || viewerId;
  const date = searchParams.get('date');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit')) || 100, 500));
    const skip = parseInt(searchParams.get('skip')) || 0;

    // Validate targetUserId format if different from current user
    if (targetUserId !== viewerId && !/^[a-f\d]{24}$/i.test(String(targetUserId))) {
      return NextResponse.json({ success: false, error: 'Invalid user ID format' }, { status: 400 });
    }

    // Ensure target user exists when viewing someone else
    if (targetUserId.toString() !== viewerId.toString()) {
      const targetUserExists = await store.get('users', String(targetUserId));
      if (!targetUserExists) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
      }
    }

    // Check access permission
    const canView = await canViewTenantScreenshots(viewerId, targetUserId, viewerRole, tenant.databaseName);
    if (!canView) {
      return NextResponse.json({ 
        success: false, 
        error: 'Access denied' 
      }, { status: 403 });
    }

    // Build query
    const query = { user: targetUserId };

    if (date) {
      const parsed = new Date(date);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ success: false, error: 'Invalid date format' }, { status: 400 });
      }
      query.dateString = date;
    } else if (startDate && endDate) {
      const startParsed = new Date(startDate);
      const endParsed = new Date(endDate + 'T23:59:59.999Z');
      if (Number.isNaN(startParsed.getTime()) || Number.isNaN(endParsed.getTime())) {
        return NextResponse.json({ success: false, error: 'Invalid date range' }, { status: 400 });
      }
      query.capturedAt = {
        $gte: startParsed,
        $lte: endParsed
      };
    } else if (startDate) {
      const startParsed = new Date(startDate);
      if (Number.isNaN(startParsed.getTime())) {
        return NextResponse.json({ success: false, error: 'Invalid startDate format' }, { status: 400 });
      }
      query.capturedAt = { $gte: startParsed };
    } else if (endDate) {
      const endParsed = new Date(endDate + 'T23:59:59.999Z');
      if (Number.isNaN(endParsed.getTime())) {
        return NextResponse.json({ success: false, error: 'Invalid endDate format' }, { status: 400 });
      }
      query.capturedAt = { $lte: endParsed };
    }

    const filters = [{ field: 'user', operator: '==', value: String(targetUserId) }];
    if (query.dateString) filters.push({ field: 'dateString', operator: '==', value: query.dateString });
    if (query.capturedAt?.$gte) filters.push({ field: 'capturedAt', operator: '>=', value: query.capturedAt.$gte });
    if (query.capturedAt?.$lte) filters.push({ field: 'capturedAt', operator: '<=', value: query.capturedAt.$lte });
    if (skip < 0 || skip > 10000) return NextResponse.json({ error: 'Invalid pagination offset' }, { status: 400 });
    let cursor = searchParams.get('cursor') || undefined, visited = 0;
    const screenshots = [];
    do {
      const page = await store.list('screenshots', { filters, orderBy: [{ field: 'capturedAt', direction: 'desc' }], limit: Math.min(100, skip + limit - visited), cursor });
      for (const record of page.records) { if (visited++ >= skip) screenshots.push(record); }
      cursor = page.nextCursor;
    } while (cursor && screenshots.length < limit);
    const total = await store.count('screenshots', filters);

    // Get user info for context
    const targetUser = await store.get('users', String(targetUserId));

    return NextResponse.json({
      success: true,
      screenshots: screenshots.map(s => ({
        id: s._id.toString(),
        capturedAt: s.capturedAt,
        dateString: s.dateString,
        formattedTime: new Date(s.capturedAt).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }),
        activity: s.activity,
        metadata: {
          mimeType: s.metadata?.mimeType,
          width: s.metadata?.width,
          height: s.metadata?.height,
          fileSize: s.metadata?.fileSize
        },
        sessionId: s.sessionId,
        analyzed: !!s.analyzed,
        analyzedAt: s.analyzedAt || null,
        // URL to fetch the actual image
        imageUrl: `/api/activity/screenshot?id=${s._id}`
      })),
      pagination: {
        total,
        nextCursor: cursor || null,
        limit,
        skip,
        hasMore: skip + screenshots.length < total
      },
      user: targetUser ? {
        id: targetUser._id.toString(),
        name: targetUser.name,
        email: targetUser.email
      } : null
    });

  } catch (error) {
    console.error('[Screenshots] List error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
