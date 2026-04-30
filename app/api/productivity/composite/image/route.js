/**
 * GET /api/productivity/composite/image?id=&userId=&date=YYYY-MM-DD
 *
 * Streams the stitched composite WebP for one (user, dateString). Auth +
 * permission identical to /api/productivity/composite metadata endpoint.
 */
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { getAuthAndModels } from '@/lib/auth';
import { canViewUserScreenshots } from '@/lib/productivityPermissions';
import { getScreenshot } from '@/lib/gridfs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'ScreenshotComposite']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, models, tenant } = auth;
    const { ScreenshotComposite } = models;

    const viewerId = user._id || user.userId;
    const viewerRole = user.role;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const date = searchParams.get('date');
    const targetUserId = searchParams.get('userId') || viewerId.toString();

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ success: false, error: 'Invalid date' }, { status: 400 });
    }
    if (targetUserId !== viewerId.toString() && !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return NextResponse.json({ success: false, error: 'Invalid userId' }, { status: 400 });
    }

    const composite = await ScreenshotComposite.findOne({
      _id: id,
      user: targetUserId,
      dateString: date,
    }).select('user dateString gridfsFileId mimeType').lean();

    if (!composite || !composite.gridfsFileId) {
      return NextResponse.json({ success: false, error: 'Composite not found' }, { status: 404 });
    }

    const canView = await canViewUserScreenshots(viewerId, composite.user.toString(), viewerRole, models);
    if (!canView) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const buffer = await getScreenshot(composite.gridfsFileId, {
      databaseName: tenant.databaseName,
    });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': composite.mimeType || 'image/jpeg',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    console.error('[Productivity/Composite/Image] Error:', err);
    return NextResponse.json({ success: false, error: 'Failed to load composite image' }, { status: 500 });
  }
}
