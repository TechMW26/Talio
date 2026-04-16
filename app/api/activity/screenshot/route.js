import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth'
import { mkdir, writeFile, access, constants, unlink } from 'fs/promises';
import path from 'path';
import { uploadScreenshot, getScreenshot } from '@/lib/gridfs';
import { checkAndTriggerSessionAnalysis } from '@/lib/autoAnalysisTrigger';
import mongoose from 'mongoose';

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Ensure directory exists
 */
async function ensureDirectory(dirPath) {
  try {
    await access(dirPath, constants.W_OK);
  } catch {
    await mkdir(dirPath, { recursive: true, mode: 0o755 });
    console.log(`[Screenshot] Created directory: ${dirPath}`);
  }
}

/**
 * POST /api/activity/screenshot
 * Upload a screenshot - saves to BOTH filesystem and GridFS
 * Filesystem: For dashboard display (existing flow)
 * GridFS: For long-term storage and AI analysis
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Screenshot', 'ProductivitySession']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models, tenant } = auth;
    const { User, Employee, Screenshot, ProductivitySession } = models;

    const userId = user._id || user.userId;
    const userRole = user.role;

    // Skip for admin roles
    if (['admin'].includes(userRole)) {
      return NextResponse.json({
        success: false,
        error: 'Screenshot capture not enabled for admin roles'
      }, { status: 400 });
    }

    // Get form data
    const formData = await request.formData();
    const file = formData.get('screenshot');
    const activityData = formData.get('activity');
    const sessionId = formData.get('sessionId');
    const captureType = String(formData.get('captureType') || 'automatic').trim() || 'automatic'
    const requestedTimestamp = String(formData.get('timestamp') || '').trim()

    if (!file) {
      return NextResponse.json({
        success: false,
        error: 'No screenshot file provided'
      }, { status: 400 });
    }

    // Get file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse activity data
    let activity = {};
    if (activityData) {
      try {
        activity = JSON.parse(activityData);
      } catch (e) {
        console.warn('[Screenshot] Failed to parse activity data:', e.message);
      }
    }

    // Get employee info with full details for folder structure
    const userRecord = await User.findById(userId).select('employeeId name email');
    let employee = null;
    let employeeId = userRecord?.employeeId;

    if (employeeId) {
      employee = await Employee.findById(employeeId).select('firstName lastName employeeCode');
    }

    if (!employee && userRecord?.email) {
      employee = await Employee.findOne({ email: userRecord.email.toLowerCase() }).select('firstName lastName employeeCode');
      if (employee) {
        employeeId = employee._id;
      }
    }

    // Determine file format from content type
    const mimeType = file.type || 'image/png';
    const format = mimeType.split('/')[1] || 'png';

    const capturedAt = requestedTimestamp ? new Date(requestedTimestamp) : new Date()
    const safeCapturedAt = Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt
    const dateString = safeCapturedAt.toISOString().split('T')[0];
    const timestamp = safeCapturedAt.getTime();
    const employeeCode = employee?.employeeCode || 'UNKNOWN';
    const filename = `screenshot_${employeeCode}_${timestamp}.webp`;

    // Only deduplicate true retry uploads around the same capture timestamp.
    const duplicateWindowMs = 15 * 1000
    const duplicateWindowStart = new Date(safeCapturedAt.getTime() - duplicateWindowMs)
    const duplicateWindowEnd = new Date(safeCapturedAt.getTime() + duplicateWindowMs)
    const duplicateQuery = {
      user: userId,
      capturedAt: { $gte: duplicateWindowStart, $lte: duplicateWindowEnd },
      captureType,
    }

    if (sessionId) {
      duplicateQuery.sessionId = sessionId
    }

    const existingDuplicate = await Screenshot.findOne(duplicateQuery)
      .select('_id capturedAt sessionId')
      .lean();

    if (existingDuplicate) {
      console.log(
        `[Screenshot] ⏭️ Retry duplicate skipped for user ${userId} - existing capture at ${existingDuplicate.capturedAt.toISOString()}`
      );
      return NextResponse.json({
        success: true,
        deduplicated: true,
        message: 'Screenshot retry detected and skipped',
        existingScreenshotId: existingDuplicate._id.toString(),
        timestamp: safeCapturedAt.toISOString()
      });
    }

    // Generate employee folder name for filesystem fallback
    const firstName = (employee?.firstName || '').replace(/[^a-zA-Z0-9]/g, '');
    const lastName = (employee?.lastName || '').replace(/[^a-zA-Z0-9]/g, '');
    const employeeFolderName = `${firstName}${lastName}-${employeeCode}`;

    let publicPath = '';
    let gridfsResult = null;

    // === GRIDFS STORAGE (primary - for long-term storage & AI analysis) ===
    try {
      gridfsResult = await uploadScreenshot(buffer, {
        userId,
        employeeId: employeeId?.toString(),
        capturedAt: safeCapturedAt,
        sessionId,
        mimeType,
        format,
        width: 1920,
        height: 1080,
        activity
      });
      console.log(`[Screenshot] ✅ Uploaded to GridFS: ${gridfsResult._id}`);
    } catch (gridfsError) {
      console.error('[Screenshot] ❌ GridFS upload failed:', gridfsError.message);
    }

    // === FALLBACK: FILESYSTEM STORAGE (for dashboard display) ===
    if (!gridfsResult) {
      const activityDir = path.join(process.cwd(), 'public', 'activity', employeeFolderName, dateString);
      await ensureDirectory(activityDir);

      const filePath = path.join(activityDir, filename);
      await writeFile(filePath, buffer);

      publicPath = `/activity/${employeeFolderName}/${dateString}/${filename}`;
      console.log(`[Screenshot] Saved to filesystem: ${publicPath}`);
    }

    // === DATABASE RECORD ===
    const screenshot = new Screenshot({
      user: userId,
      employee: employeeId,
      gridfsFileId: gridfsResult?._id || null,
      capturedAt: safeCapturedAt,
      dateString,
      path: publicPath || null,
      filename,
      metadata: {
        mimeType,
        width: 1920,
        height: 1080,
        fileSize: buffer.length,
        format,
        storage: gridfsResult ? 'gridfs' : 'filesystem'
      },
      captureType,
      activity: {
        activeWindow: activity.activeWindow || '',
        activeApp: activity.activeApp || '',
        keystrokes: activity.keystrokes || 0,
        mouseClicks: activity.mouseClicks || 0,
        mouseMovements: activity.mouseMovements || 0,
        isIdle: activity.isIdle || false
      },
      sessionId
    });

    await screenshot.save();

    console.log(`[Screenshot] Saved for user ${userId}: ${screenshot._id}${gridfsResult ? ` (GridFS: ${gridfsResult._id})` : ''}`);

    // Auto-trigger session analysis if session is complete (60 screenshots)
    // Run async — don't block the upload response
    checkAndTriggerSessionAnalysis({
      userId,
      employeeId,
      databaseName: tenant.databaseName,
      capturedAt: safeCapturedAt,
      models: { Screenshot, ProductivitySession }
    }).then(result => {
      if (result.triggered) {
        console.log(`[Screenshot] Auto-analysis triggered for session ${result.sessionId}`);
      }
    }).catch(err => {
      console.error('[Screenshot] Auto-analysis check failed (non-blocking):', err.message);
    });

    return NextResponse.json({
      success: true,
      screenshotId: screenshot._id.toString(),
      gridfsId: gridfsResult?._id?.toString() || null,
      path: publicPath,
      timestamp: safeCapturedAt.toISOString(),
      fileSize: buffer.length,
      storage: gridfsResult ? 'gridfs' : 'filesystem'
    });

  } catch (error) {
    console.error('[Screenshot] Upload error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

/**
 * GET /api/activity/screenshot?id=xxx
 * Retrieve a screenshot image by ID (from GridFS or filesystem)
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Department', 'Screenshot']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { User, Employee, Department, Screenshot } = models;

    const userId = user._id || user.userId;
    const userRole = user.role;

    const { searchParams } = new URL(request.url);
    const screenshotId = searchParams.get('id');

    if (!screenshotId) {
      return NextResponse.json({
        success: false,
        error: 'Screenshot ID required'
      }, { status: 400 });
    }

    // Validate screenshotId format
    if (!mongoose.Types.ObjectId.isValid(screenshotId)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid screenshot ID format'
      }, { status: 400 });
    }

    // Get screenshot metadata
    const screenshot = await Screenshot.findById(screenshotId);
    if (!screenshot) {
      return NextResponse.json({
        success: false,
        error: 'Screenshot not found'
      }, { status: 404 });
    }

    // Access control - check if user can view this screenshot
    let hasAccess = false;

    // Admin, HR, Manager can view all
    if (['admin', 'hr', 'manager'].includes(userRole)) {
      hasAccess = true;
    }
    // Same user
    else if (screenshot.user.toString() === userId.toString()) {
      hasAccess = true;
    }
    // Department head check
    else {
      const viewer = await User.findById(userId).select('employeeId');
      const screenshotOwner = await User.findById(screenshot.user).select('employeeId');

      if (viewer?.employeeId && screenshotOwner?.employeeId) {
        const viewerEmployee = await Employee.findById(viewer.employeeId).select('_id');
        const ownerEmployee = await Employee.findById(screenshotOwner.employeeId).select('department departments');

        if (viewerEmployee && ownerEmployee) {
          // Get owner's departments
          const ownerDepartments = [];
          if (ownerEmployee.department) ownerDepartments.push(ownerEmployee.department);
          if (ownerEmployee.departments?.length) ownerDepartments.push(...ownerEmployee.departments);

          // Check if viewer is head of any department
          const departments = await Department.find({
            _id: { $in: ownerDepartments },
            $or: [
              { head: viewerEmployee._id },
              { heads: viewerEmployee._id }
            ]
          });

          hasAccess = departments.length > 0;
        }
      }
    }

    if (!hasAccess) {
      return NextResponse.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 });
    }

    // Try GridFS first
    if (!screenshot.gridfsFileId) {
      return NextResponse.json({
        success: false,
        error: 'Screenshot image not available'
      }, { status: 404 });
    }

    const imageBuffer = await getScreenshot(screenshot.gridfsFileId);

    // Return image
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': screenshot.metadata?.mimeType || 'image/png',
        'Content-Length': imageBuffer.length.toString(),
        'Cache-Control': 'private, max-age=3600'
      }
    });

  } catch (error) {
    console.error('[Screenshot] Retrieval error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
