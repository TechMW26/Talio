import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { mkdir, access, constants } from 'fs/promises';
import path from 'path';

/**
 * Ensure user activity folder exists
 */
async function ensureUserActivityFolder(userId) {
  const activityDir = path.join(process.cwd(), 'public', 'activity', userId);
  
  try {
    await access(activityDir, constants.W_OK);
    return { exists: true, path: activityDir };
  } catch {
    try {
      await mkdir(activityDir, { recursive: true, mode: 0o755 });
      console.log(`[Health] Created activity folder for user ${userId}`);
      return { exists: true, path: activityDir, created: true };
    } catch (error) {
      console.error(`[Health] Failed to create folder for ${userId}:`, error.message);
      return { exists: false, error: error.message };
    }
  }
}

/**
 * GET /api/activity/health
 * Health check endpoint for desktop app
 * Also ensures user activity folder exists
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User'])
    if (!auth.success) {
      return NextResponse.json({ 
        success: false, 
        healthy: false,
        error: auth.message || 'Unauthorized' 
      }, { status: 401 })
    }
    const { user, models } = auth
    const { User } = models

    const userId = user._id || user.userId;
    const userRole = user.role;

    // Ensure user's activity folder exists
    const folderResult = await ensureUserActivityFolder(userId.toString());

    return NextResponse.json({
      success: true,
      healthy: true,
      timestamp: new Date().toISOString(),
      userId,
      role: userRole,
      captureEnabled: !['admin'].includes(userRole),
      database: 'connected',
      activityFolder: folderResult,
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed,
        platform: process.platform
      }
    });

  } catch (error) {
    console.error('[Health] Error:', error);
    return NextResponse.json({
      success: false,
      healthy: false,
      error: error.message
    }, { status: 500 });
  }
}
