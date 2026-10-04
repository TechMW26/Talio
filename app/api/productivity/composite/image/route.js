/**
 * GET /api/productivity/composite/image?id=&userId=&date=YYYY-MM-DD
 *
 * Streams the stitched composite WebP for one (user, dateString). Auth +
 * permission identical to /api/productivity/composite metadata endpoint.
 */
import { NextResponse } from 'next/server';
import { verifyTokenFromRequest } from '@/lib/auth';
import { canViewTenantScreenshots } from '@/lib/productivityPermissions';
import { getScreenshotStore } from '@/lib/platform/firestoreScreenshots.server';
import { getScreenshot } from '@/lib/mediaStorage';
import sharp from 'sharp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const auth = await verifyTokenFromRequest(request);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, tenant } = auth;
    const store = await getScreenshotStore(tenant.databaseName);

    const viewerId = user._id || user.userId;
    const viewerRole = user.role;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const date = searchParams.get('date');
    const targetUserId = searchParams.get('userId') || viewerId.toString();

    if (!/^[a-f0-9]{24}$/i.test(id || '')) {
      return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ success: false, error: 'Invalid date' }, { status: 400 });
    }
    if (!/^[a-f0-9]{24}$/i.test(targetUserId)) {
      return NextResponse.json({ success: false, error: 'Invalid userId' }, { status: 400 });
    }

    const composite = await store.get('screenshotcomposites', id);

    if (!composite || String(composite.user) !== targetUserId || composite.dateString !== date || !composite.gridfsFileId) {
      return NextResponse.json({ success: false, error: 'Composite not found' }, { status: 404 });
    }

    const canView = await canViewTenantScreenshots(viewerId, composite.user.toString(), viewerRole, tenant.databaseName);
    if (!canView) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    let buffer = await getScreenshot(composite.gridfsFileId, {
      databaseName: tenant.databaseName,
    });
    const tileValue = searchParams.get('tile');
    if (tileValue !== null) {
      const index = Number(tileValue);
      const tile = Number.isInteger(index) && index >= 0 && composite.tiles?.find(t => t.index === index);
      if (!tile) return NextResponse.json({ success: false, error: 'Tile not found' }, { status: 404 });
      buffer = await sharp(buffer).extract({ left: tile.x, top: tile.y, width: tile.width, height: tile.height }).webp().toBuffer();
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': tileValue !== null ? 'image/webp' : composite.mimeType || 'image/jpeg',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[Productivity/Composite/Image] Error:', err);
    return NextResponse.json({ success: false, error: 'Failed to load composite image' }, { status: 500 });
  }
}
