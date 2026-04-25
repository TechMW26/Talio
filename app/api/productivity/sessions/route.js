import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { enrichPersistedProductivityAnalysis } from '@/lib/productivityAnalysisResult';
import {
  buildSessionGroupsFromScreenshots,
  buildSessionScreenshotDoc,
  SCREENSHOTS_PER_SESSION,
} from '@/lib/productivitySessionRules';

function normalizeSessionScreenshotsForResponse(screenshots = []) {
  return screenshots.map((screenshot) => {
    if (!screenshot || screenshot.deletedAt) {
      return screenshot;
    }

    if (screenshot.url?.startsWith('/api/images/') || screenshot.path?.startsWith('/api/images/')) {
      return buildSessionScreenshotDoc(screenshot);
    }

    return screenshot;
  });
}

const SESSION_WINDOW_MS = 60 * 60 * 1000;  // 60-minute session windows
const MAX_SCREENSHOTS_PER_SESSION = 20;     // 3-min interval × 20 = 60 min max
const DEDUP_TOLERANCE_MS = 90 * 1000;       // 90-second tolerance for near-duplicate captures

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
 * Deduplicate screenshots: if two captures are within DEDUP_TOLERANCE_MS of each other,
 * keep only the first one. This removes re-uploads/retries that bypassed the 15s upload dedup.
 */
function deduplicateByInterval(screenshots) {
  if (screenshots.length === 0) return screenshots;
  const deduped = [screenshots[0]];
  for (let i = 1; i < screenshots.length; i++) {
    const prev = new Date(deduped[deduped.length - 1].timestamp).getTime();
    const curr = new Date(screenshots[i].timestamp).getTime();
    if (curr - prev >= DEDUP_TOLERANCE_MS) {
      deduped.push(screenshots[i]);
    }
  }
  return deduped;
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
  const dayStart = new Date(dateFolder);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  let screenshots = [];

  // First, try to get screenshots from the Screenshot model (primary source)
  if (Screenshot) {
    const dbScreenshots = await Screenshot.find({
      user: userId,
      dateString: dateFolder
    }).sort({ capturedAt: 1 }).lean();

    for (const ss of dbScreenshots) {
      screenshots.push({
        ...ss,
        path: ss.path || `/api/activity/screenshot?id=${ss._id}`,
        filename: ss.filename || `screenshot_${ss._id}.webp`,
        timestamp: ss.capturedAt,
        size: ss.metadata?.fileSize || 0
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
          size: fileStat.size,
          captureType: 'automatic',
          sessionId: null,
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

  // Deduplicate near-identical captures before grouping
  const deduped = deduplicateByInterval(screenshots);
  console.log(`Found ${screenshots.length} screenshots for user ${userId} on ${dateFolder} (${deduped.length} after dedup)`);

  // Get user and employee info
  const user = await User.findById(userId).select('employeeId');
  const employeeId = user?.employeeId;

  const sessionGroups = buildSessionGroupsFromScreenshots(
    screenshots.sort((a, b) => new Date(a.timestamp || a.capturedAt) - new Date(b.timestamp || b.capturedAt))
  );

  const existingSessions = await ProductivitySession.find({
    user: userId,
    date: { $gte: dayStart, $lt: dayEnd },
  }).sort({ startTime: 1 });

  const existingSessionsBySourceSessionId = new Map();
  const staleSessionIds = [];
  const activeSourceSessionIds = new Set(
    sessionGroups.filter(group => group.sourceSessionId).map(group => group.sourceSessionId)
  );

  for (const session of existingSessions) {
    if (session.analysis?.isAnalyzed) {
      continue;
    }

    if (session.sourceSessionId) {
      if (activeSourceSessionIds.has(session.sourceSessionId)) {
        existingSessionsBySourceSessionId.set(session.sourceSessionId, session);
      } else {
        staleSessionIds.push(session._id);
      }
      continue;
    }

    staleSessionIds.push(session._id);
  }

  if (staleSessionIds.length > 0) {
    await ProductivitySession.deleteMany({ _id: { $in: staleSessionIds } });
  }

  if (sessionGroups.length === 0) {
    await ProductivitySession.deleteMany({
      user: userId,
      date: { $gte: dayStart, $lt: dayEnd },
      'analysis.isAnalyzed': { $ne: true },
    });
    return [];
  }

  const result = [];
  for (const group of sessionGroups) {
    const mappedScreenshots = group.screenshots.map(buildSessionScreenshotDoc);
    let session = group.sourceSessionId
      ? existingSessionsBySourceSessionId.get(group.sourceSessionId) || null
      : null;

    if (!session) {
      session = new ProductivitySession({
        user: userId,
        employee: employeeId,
        date: dayStart,
        sourceSessionId: group.sourceSessionId || null,
      });
    }

    session.employee = employeeId;
    session.date = dayStart;
    session.sourceSessionId = group.sourceSessionId || null;
    session.screenshots = mappedScreenshots;
    session.screenshotCount = mappedScreenshots.length;
    session.startTime = group.startTime;
    session.endTime = group.endTime;
    session.isComplete = mappedScreenshots.length >= SCREENSHOTS_PER_SESSION;
    session.estimatedDuration = Math.max(
      1,
      Math.round((new Date(group.endTime) - new Date(group.startTime)) / 60000)
    );

    await session.save();
    result.push(session);
  }

  const allSessionsForDay = await ProductivitySession.find({
    user: userId,
    date: { $gte: dayStart, $lt: dayEnd },
  }).sort({ startTime: 1 });

  const renumberOps = [];
  for (let i = 0; i < allSessionsForDay.length; i++) {
    const expectedSessionNumber = i + 1;
    if (allSessionsForDay[i].sessionNumber !== expectedSessionNumber) {
      renumberOps.push({
        updateOne: {
          filter: { _id: allSessionsForDay[i]._id },
          update: { $set: { sessionNumber: expectedSessionNumber } },
        },
      });
    }
  }

  if (renumberOps.length > 0) {
    await ProductivitySession.bulkWrite(renumberOps);
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

    const normalizedSessions = dbSessions.map((sessionDoc) => {
      const session = sessionDoc.toObject ? sessionDoc.toObject() : sessionDoc;
      if (Array.isArray(session.screenshots)) {
        session.screenshots = normalizeSessionScreenshotsForResponse(session.screenshots);
      }
      if (session.analysis?.isAnalyzed) {
        session.analysis = enrichPersistedProductivityAnalysis(session.analysis);
      }
      return session;
    });

    return NextResponse.json({
      success: true,
      data: normalizedSessions,
      date: dateParam,
      userId: targetUserId,
      totalSessions: normalizedSessions.length,
      totalScreenshots: normalizedSessions.reduce((sum, s) => sum + s.screenshotCount, 0)
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
