import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { mkdir, access, constants } from 'fs/promises';
import path from 'path';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

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
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ 
        success: false, 
        healthy: false,
        error: 'Unauthorized' 
      }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
      decoded = await jwtVerify(token, JWT_SECRET);
    } catch {
      return NextResponse.json({ 
        success: false, 
        healthy: false,
        error: 'Invalid token' 
      }, { status: 401 });
    }

    const userId = decoded.payload.userId;
    const userRole = decoded.payload.role;

    // Ensure user's activity folder exists
    const folderResult = await ensureUserActivityFolder(userId);

    // Connect to DB to verify connection
    let dbConnected = false;
    try {
      await connectDB();
      dbConnected = true;
    } catch (error) {
      console.error('[Health] DB connection error:', error.message);
    }

    return NextResponse.json({
      success: true,
      healthy: true,
      timestamp: new Date().toISOString(),
      userId,
      role: userRole,
      captureEnabled: !['admin', 'god_admin'].includes(userRole),
      database: dbConnected ? 'connected' : 'error',
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
