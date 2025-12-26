import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { readdir, stat } from 'fs/promises';
import path from 'path';

const SCREENSHOTS_PER_SESSION = 30;

/**
 * Parse screenshot filename to get timestamp
 * Format: 2024-12-13T10-30-45-123Z.webp
 */
function parseScreenshotTimestamp(filename) {
  try {
    // Remove extension and convert back to ISO format
    const nameWithoutExt = filename.replace(/\.(webp|png|jpg|jpeg)$/i, '');
    // Replace dashes back to colons/dots for ISO format
    const isoString = nameWithoutExt
      .replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z');
    return new Date(isoString);
  } catch {
    return new Date();
  }
}

/**
 * Scan filesystem for screenshots and create/update sessions
 * @param {string} userId - User ID
 * @param {Date} date - Date to scan
 * @param {Object} models - Tenant-specific models { User, ProductivitySession }
 */
async function syncScreenshotsToSessions(userId, date, models) {
  const { User, ProductivitySession } = models;
  const activityDir = path.join(process.cwd(), 'public', 'activity', userId);
  const dateFolder = date.toISOString().split('T')[0];
  const datePath = path.join(activityDir, dateFolder);
  
  let screenshots = [];
  
  try {
    const files = await readdir(datePath);
    const imageFiles = files.filter(f => /\.(webp|png|jpg|jpeg)$/i.test(f));
    
    for (const file of imageFiles) {
      const filePath = path.join(datePath, file);
      const fileStat = await stat(filePath);
      
      screenshots.push({
        path: `/activity/${userId}/${dateFolder}/${file}`,
        filename: file,
        timestamp: parseScreenshotTimestamp(file),
        size: fileStat.size
      });
    }
    
    // Sort by timestamp
    screenshots.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  } catch (error) {
    // Directory doesn't exist or is empty
    console.log(`No screenshots found for user ${userId} on ${dateFolder}`);
    return [];
  }
  
  if (screenshots.length === 0) {
    return [];
  }
  
  // Get user and employee info
  const user = await User.findById(userId).select('employeeId');
  const employeeId = user?.employeeId;
  
  // Group into sessions of 30
  const sessions = [];
  for (let i = 0; i < screenshots.length; i += SCREENSHOTS_PER_SESSION) {
    const sessionScreenshots = screenshots.slice(i, i + SCREENSHOTS_PER_SESSION);
    const sessionNumber = Math.floor(i / SCREENSHOTS_PER_SESSION) + 1;
    
    // Check if session already exists
    let session = await ProductivitySession.findOne({
      user: userId,
      date: {
        $gte: new Date(dateFolder),
        $lt: new Date(new Date(dateFolder).getTime() + 24 * 60 * 60 * 1000)
      },
      sessionNumber
    });
    
    if (!session) {
      // Create new session
      session = new ProductivitySession({
        user: userId,
        employee: employeeId,
        date: new Date(dateFolder),
        sessionNumber,
        screenshots: sessionScreenshots,
        startTime: sessionScreenshots[0].timestamp,
        endTime: sessionScreenshots[sessionScreenshots.length - 1].timestamp
      });
      await session.save();
    } else if (session.screenshotCount !== sessionScreenshots.length) {
      // Update session with new screenshots
      session.screenshots = sessionScreenshots;
      session.startTime = sessionScreenshots[0].timestamp;
      session.endTime = sessionScreenshots[sessionScreenshots.length - 1].timestamp;
      await session.save();
    }
    
    sessions.push(session);
  }
  
  return sessions;
}

/**
 * GET /api/productivity/sessions
 * Get sessions for current user or specified user (with permission check)
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ProductivitySession', 'User', 'Employee', 'Department']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { ProductivitySession, User, Employee, Department } = models;

    const currentUserId = user._id.toString();
    const currentUserRole = user.role;
    
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId') || currentUserId;
    const dateParam = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const date = new Date(dateParam);
    
    // Permission check: Can only view others' sessions if admin/hr or department head
    if (targetUserId !== currentUserId) {
      const currentUser = await User.findById(currentUserId).populate('employeeId');
      const targetUser = await User.findById(targetUserId).populate('employeeId');
      
      const isAdminOrHR = ['admin', 'hr'].includes(currentUserRole);
      
      // Check if current user is department head of target user's department
      let isDeptHead = false;
      if (!isAdminOrHR && targetUser?.employeeId?.department) {
        const dept = await Department.findById(targetUser.employeeId.department);
        if (dept) {
          const allHeads = dept.allHeads || [];
          isDeptHead = allHeads.includes(currentUser?.employeeId?._id?.toString());
        }
      }
      
      if (!isAdminOrHR && !isDeptHead) {
        return NextResponse.json(
          { success: false, error: 'Permission denied' },
          { status: 403 }
        );
      }
    }
    
    // Sync screenshots from filesystem and get sessions
    const sessions = await syncScreenshotsToSessions(targetUserId, date, models);
    
    // Fetch from database to get full session data with analysis
    const dbSessions = await ProductivitySession.find({
      user: targetUserId,
      date: {
        $gte: date,
        $lt: new Date(date.getTime() + 24 * 60 * 60 * 1000)
      }
    }).sort({ sessionNumber: 1 });
    
    return NextResponse.json({
      success: true,
      data: dbSessions,
      date: dateParam,
      userId: targetUserId,
      totalSessions: dbSessions.length,
      totalScreenshots: dbSessions.reduce((sum, s) => sum + s.screenshotCount, 0)
    });
    
  } catch (error) {
    console.error('Get sessions error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get sessions', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/productivity/sessions/sync
 * Force sync screenshots from filesystem to database
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ProductivitySession', 'User', 'Employee']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;

    const userId = user._id.toString();
    
    const body = await request.json();
    const date = body.date ? new Date(body.date) : new Date();
    
    const sessions = await syncScreenshotsToSessions(userId, date, models);
    
    return NextResponse.json({
      success: true,
      message: 'Sessions synced successfully',
      sessionsCreated: sessions.length
    });
    
  } catch (error) {
    console.error('Sync sessions error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to sync sessions', details: error.message },
      { status: 500 }
    );
  }
}
