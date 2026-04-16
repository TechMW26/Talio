import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { readdir, stat } from 'fs/promises';
import path from 'path';

const SESSION_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

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
 * Sync screenshots to sessions - checks both database and filesystem
 * @param {string} userId - User ID
 * @param {Date} date - Date to scan
 * @param {Object} models - Tenant-specific models { User, ProductivitySession, Screenshot }
 */
async function syncScreenshotsToSessions(userId, date, models) {
  const { User, ProductivitySession, Screenshot } = models;
  const dateFolder = date.toISOString().split('T')[0];

  let screenshots = [];

  // First, try to get screenshots from the Screenshot model (primary source)
  if (Screenshot) {
    const dbScreenshots = await Screenshot.find({
      user: userId,
      dateString: dateFolder
    }).sort({ capturedAt: 1 }).lean();

    for (const ss of dbScreenshots) {
      const displayPath = ss.path || `/api/activity/screenshot?id=${ss._id}`;
      screenshots.push({
        path: displayPath,
        filename: ss.filename || `screenshot_${ss._id}.webp`,
        timestamp: ss.capturedAt,
        size: ss.metadata?.fileSize || 0,
        gridfsFileId: ss.gridfsFileId || null
      });
    }
  }

  // Fallback: also check filesystem if no DB screenshots found
  if (screenshots.length === 0) {
    const activityDir = path.join(process.cwd(), 'public', 'activity', userId.toString());
    const datePath = path.join(activityDir, dateFolder);

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
      // Directory doesn't exist or is empty - that's fine if we have DB screenshots
    }
  }

  if (screenshots.length === 0) {
    console.log(`No screenshots found for user ${userId} on ${dateFolder}`);
    return [];
  }

  console.log(`Found ${screenshots.length} screenshots for user ${userId} on ${dateFolder}`);

  // Get user and employee info
  const user = await User.findById(userId).select('employeeId');
  const employeeId = user?.employeeId;

  // Group into sessions by 60-minute hourly windows
  const sessions = [];
  let currentGroup = [];
  let windowStart = null;
  
  for (const ss of screenshots) {
    const t = new Date(ss.timestamp).getTime();
    if (windowStart === null) {
      const d = new Date(t);
      windowStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0).getTime();
    }
    if (t >= windowStart + SESSION_WINDOW_MS) {
      if (currentGroup.length > 0) {
        sessions.push(currentGroup);
      }
      const d = new Date(t);
      windowStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0).getTime();
      currentGroup = [];
    }
    currentGroup.push(ss);
  }
  if (currentGroup.length > 0) {
    sessions.push(currentGroup);
  }

  const result = [];
  for (let i = 0; i < sessions.length; i++) {
    const sessionScreenshots = sessions[i];
    const sessionNumber = i + 1;

    // Map screenshot data to match ProductivitySession schema
    const mappedScreenshots = sessionScreenshots.map(ss => ({
      path: ss.path, // path contains the URL or relative path (matches schema)
      url: ss.path,  // Also keep url for frontend compatibility
      fileId: ss.gridfsFileId || null, // GridFS fileId for cleanup
      timestamp: ss.timestamp,
      capturedAt: ss.timestamp, // For frontend compatibility
      filename: ss.filename
    }));

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
        screenshots: mappedScreenshots,
        screenshotCount: mappedScreenshots.length,
        startTime: sessionScreenshots[0].timestamp,
        endTime: sessionScreenshots[sessionScreenshots.length - 1].timestamp
      });
      await session.save();
      console.log(`Created session ${sessionNumber} with ${mappedScreenshots.length} screenshots`);
    } else if (session.screenshotCount !== mappedScreenshots.length) {
      // Update session with new screenshots
      session.screenshots = mappedScreenshots;
      session.screenshotCount = mappedScreenshots.length;
      session.startTime = sessionScreenshots[0].timestamp;
      session.endTime = sessionScreenshots[sessionScreenshots.length - 1].timestamp;
      await session.save();
    }

    result.push(session);
  }

  return result;
}

/**
 * GET /api/productivity/sessions
 * Get sessions for current user or specified user (with permission check)
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ProductivitySession', 'User', 'Employee', 'Department', 'Screenshot']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { ProductivitySession, User, Employee, Department, Screenshot } = models;

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
          const currentEmployeeId = currentUser?.employeeId?._id?.toString();
          // Check both legacy head field and heads array
          const isLegacyHead = dept.head?.toString() === currentEmployeeId;
          const isInHeadsArray = dept.heads?.some(h => h?.toString() === currentEmployeeId);
          isDeptHead = isLegacyHead || isInHeadsArray;

          console.log(`[Sessions API] Permission check - currentEmployee: ${currentEmployeeId}, dept.head: ${dept.head}, dept.heads: ${JSON.stringify(dept.heads)}, isDeptHead: ${isDeptHead}`);
        }
      }

      // Also check if current user has isDepartmentHead flag and manages target's department
      if (!isAdminOrHR && !isDeptHead && currentUser?.isDepartmentHead) {
        const headOfDepts = currentUser.headOfDepartments || [];
        const targetDeptId = targetUser?.employeeId?.department?.toString();
        isDeptHead = headOfDepts.some(d => d?.toString() === targetDeptId);
        console.log(`[Sessions API] Checking User.headOfDepartments: ${JSON.stringify(headOfDepts)}, targetDept: ${targetDeptId}, isDeptHead: ${isDeptHead}`);
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
    }).sort({ startTime: -1 }); // Sort by latest session first

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
    const auth = await getAuthAndModels(request, ['ProductivitySession', 'User', 'Employee', 'Screenshot']);
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
