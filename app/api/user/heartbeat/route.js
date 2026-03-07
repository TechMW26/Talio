import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

/**
 * POST /api/user/heartbeat
 * Clients call this every 60s to report presence.
 * Upserts a UserPresence document with the current timestamp.
 * Used by the live-users API as a fallback when Socket.IO is unavailable (Vercel).
 */
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['UserPresence']);
    if (!auth.success) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const { user, models } = auth;
    const { UserPresence } = models;
    const userId = (user._id || user.userId)?.toString();

    let body = {};
    try { body = await request.json(); } catch { /* empty body is fine */ }

    await UserPresence.findOneAndUpdate(
      { userId },
      {
        $set: {
          lastHeartbeat: new Date(),
          employeeId: body.employeeId || user.employeeId?.toString() || undefined,
          currentPage: body.currentPage || undefined,
          userAgent: body.userAgent || undefined,
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Heartbeat] Error:', error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

/**
 * DELETE /api/user/heartbeat
 * Called when user logs out or closes the tab — removes their presence entry.
 */
export async function DELETE(request) {
  try {
    const auth = await getAuthAndModels(request, ['UserPresence']);
    if (!auth.success) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const { user, models } = auth;
    const { UserPresence } = models;
    const userId = (user._id || user.userId)?.toString();

    await UserPresence.deleteOne({ userId });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
