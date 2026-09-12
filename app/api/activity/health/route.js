import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { isScreenCaptureProtectedRole } from '@/lib/productivityPrivacy';

/**
 * GET /api/activity/health
 * Health check endpoint for desktop app
 * Validates tenant authentication without touching the deployment filesystem
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
    const { user } = auth

    const userId = user._id || user.userId;
    const userRole = user.role;

    if (!userId) {
      return NextResponse.json({
        success: false,
        healthy: false,
        error: 'User ID not found'
      }, { status: 400 });
    }


    return NextResponse.json({
      success: true,
      healthy: true,
      timestamp: new Date().toISOString(),
      userId,
      role: userRole,
      captureEnabled: !isScreenCaptureProtectedRole(userRole),
      database: 'connected',
      storage: { provider: 'mongodb-gridfs', persistentFilesystemRequired: false },
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
