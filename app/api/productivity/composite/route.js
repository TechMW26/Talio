/**
 * GET /api/productivity/composite?userId=&date=YYYY-MM-DD
 *
 * Returns the per-(user,day) screenshot composite metadata: tile rectangles,
 * grid geometry, and a URL to fetch the stitched image bytes.
 */
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { getAuthAndModels } from '@/lib/auth';
import { canViewUserScreenshots } from '@/lib/productivityPermissions';
import { getTodayDateString } from '@/lib/timezone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'ScreenshotComposite']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, models } = auth;
    const { ScreenshotComposite } = models;

    const viewerId = user._id || user.userId;
    const viewerRole = user.role;

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || getTodayDateString();
    const targetUserId = (searchParams.get('userId') || viewerId).toString();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ success: false, error: 'Invalid date' }, { status: 400 });
    }
    if (targetUserId !== viewerId.toString() && !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return NextResponse.json({ success: false, error: 'Invalid userId' }, { status: 400 });
    }

    const canView = await canViewUserScreenshots(viewerId, targetUserId, viewerRole, models);
    if (!canView) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const composite = await ScreenshotComposite.findOne({
      user: targetUserId,
      dateString: date,
    }).lean();

    if (!composite) {
      return NextResponse.json({ success: true, composite: null });
    }

    return NextResponse.json({
      success: true,
      composite: {
        id: composite._id.toString(),
        userId: composite.user.toString(),
        dateString: composite.dateString,
        width: composite.width,
        height: composite.height,
        columns: composite.columns,
        rows: composite.rows,
        tileWidth: composite.tileWidth,
        tileHeight: composite.tileHeight,
        gap: composite.gap || 0,
        tileCount: composite.tileCount || (composite.tiles?.length ?? 0),
        byteSize: composite.byteSize || 0,
        lastStitchedAt: composite.lastStitchedAt || composite.updatedAt,
        imageUrl: `/api/productivity/composite/image?id=${composite._id.toString()}&userId=${composite.user.toString()}&date=${composite.dateString}`,
        tiles: (composite.tiles || []).map((t) => ({
          index: t.index,
          x: t.x,
          y: t.y,
          width: t.width,
          height: t.height,
          capturedAt: t.capturedAt,
          activity: t.activity || null,
          productivity: t.productivity || null,
          applicationVisible: t.applicationVisible || null,
          websiteVisible: t.websiteVisible || null,
        })),
      },
    });
  } catch (err) {
    console.error('[Productivity/Composite] Error:', err);
    return NextResponse.json({ success: false, error: 'Failed to load composite' }, { status: 500 });
  }
}
