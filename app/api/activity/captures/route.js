import { NextResponse } from 'next/server';
import { verifyTokenFromRequest } from '@/lib/auth'
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { getScreenshotStore, listScreenshotMaintenanceRecords } from '@/lib/platform/firestoreScreenshots.server';
import { canViewTenantScreenshots } from '@/lib/productivityPermissions';
import { getTodayDateString } from '@/lib/timezone';

export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await verifyTokenFromRequest(request)
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, tenant } = auth;
    const store = await getScreenshotStore(tenant.databaseName);

    const currentUserId = user._id || user.userId;
    const currentUserRole = user.role;

    if (!currentUserId) {
      return NextResponse.json({ error: 'User ID not found' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId') || currentUserId;
    const dateParam = searchParams.get('date') || getTodayDateString();
    const captureType = searchParams.get('type'); // 'automatic', 'manual', or null
    const departmentId = searchParams.get('departmentId'); // Filter by department

    // Validate targetUserId format if different from current user
    if (targetUserId !== currentUserId && !/^[a-f\d]{24}$/i.test(String(targetUserId))) {
      return NextResponse.json({ error: 'Invalid user ID format' }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam) || !Number.isFinite(Date.parse(dateParam))) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    if (!await canViewTenantScreenshots(currentUserId, targetUserId, currentUserRole, tenant.databaseName)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    // Check if target user is admin (no captures)
    const targetUser = await store.get('users', String(targetUserId));
    if (['admin'].includes(targetUser?.role)) {
      return NextResponse.json({
        success: true,
        message: 'Admin screens are not captured',
        data: { captures: [], sessions: [] },
        totalCaptures: 0
      });
    }

    // Ensure targetUserId is a string for path operations
    const targetUserIdStr = targetUserId.toString();

    // Read captures from filesystem
    const activityDir = path.join(process.cwd(), 'public', 'activity', targetUserIdStr, dateParam);
    let captures = [];
    const seenPaths = new Set();

    // First, get captures from Screenshot model (v3.0.0+ desktop app)
    const dbScreenshots = (await listScreenshotMaintenanceRecords(store, 'screenshots', [{ field: 'user', operator: '==', value: String(targetUserId) }, { field: 'dateString', operator: '==', value: dateParam }])).sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));

    for (const ss of dbScreenshots) {
      // Prefer path, then construct from gridfs/screenshot ID
      const displayPath = ss._id ? `/api/activity/screenshot?id=${ss._id}` : ss.path;

      if (displayPath) {
        captures.push({
          path: displayPath,
          filename: ss.filename,
          timestamp: ss.capturedAt.toISOString(),
          size: ss.metadata?.fileSize || 0,
          date: dateParam,
          activity: ss.activity,
          screenshotId: ss._id.toString(),
          storage: ss.metadata?.storage || 'filesystem'
        });
        seenPaths.add(ss.path || displayPath);
      }
    }

    // Then, also read from filesystem for backward compatibility
    try {
      const files = await readdir(activityDir);
      const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));

      for (const file of imageFiles) {
        const publicPath = `/activity/${targetUserIdStr}/${dateParam}/${file}`;

        // Skip if already in DB results
        if (seenPaths.has(publicPath)) continue;

        const filePath = path.join(activityDir, file);
        const fileStat = await stat(filePath);
        const timestamp = parseTimestamp(file);

        captures.push({
          path: publicPath,
          filename: file,
          timestamp: timestamp.toISOString(),
          size: fileStat.size,
          date: dateParam
        });
      }

      captures.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } catch {
      // Directory doesn't exist, that's ok if we have DB results
    }

    // Get sessions from database
    const dateStart = new Date(dateParam);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(dateParam);
    dateEnd.setHours(23, 59, 59, 999);

    const sessions = (await listScreenshotMaintenanceRecords(store, 'productivitysessions', [{ field: 'user', operator: '==', value: String(targetUserId) }, { field: 'date', operator: '>=', value: dateStart }, { field: 'date', operator: '<=', value: dateEnd }])).sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    // Filter by capture type if specified
    if (captureType && sessions.length > 0) {
      captures = captures.filter(c => {
        for (const session of sessions) {
          const sc = session.screenshots.find(s => s.path === c.path);
          if (sc) return sc.captureType === captureType;
        }
        return captureType === 'automatic';
      });
    }

    // Get user info
    const userInfo = targetUser ? { ...targetUser, employeeId: targetUser.employeeId ? await store.get('employees', String(targetUser.employeeId)) : null } : null;

    return NextResponse.json({
      success: true,
      data: {
        captures,
        sessions: sessions.map(s => ({
          _id: s._id,
          sessionNumber: s.sessionNumber,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          screenshotCount: s.screenshotCount,
          isComplete: s.isComplete
        })),
        user: userInfo ? {
          _id: userInfo._id,
          email: userInfo.email,
          name: userInfo.employeeId ?
            `${userInfo.employeeId.firstName} ${userInfo.employeeId.lastName}` :
            userInfo.email,
          employeeCode: userInfo.employeeId?.employeeCode,
          role: userInfo.role,
          departmentId: userInfo.employeeId?.department
        } : null
      },
      date: dateParam,
      userId: targetUserId,
      totalCaptures: captures.length,
      totalSessions: sessions.length
    });

  } catch (error) {
    console.error('[Captures] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get captures', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Parse timestamp from filename
 * Format: 2024-12-13T10-30-45-123Z.jpg
 */
function parseTimestamp(filename) {
  try {
    const name = filename.replace(/\.(jpg|jpeg|png|webp)$/i, '');
    const isoString = name.replace(/-/g, (match, offset) => {
      // Convert back to ISO format: - to : for time parts
      if (offset === 4 || offset === 7) return '-'; // Date separators stay
      if (offset === 10) return 'T'; // T separator
      if (offset === 13 || offset === 16) return ':'; // Time separators
      if (offset === 19) return '.'; // Millisecond separator
      return match;
    });
    return new Date(isoString);
  } catch {
    return new Date();
  }
}
