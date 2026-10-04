import { NextResponse } from 'next/server';
import { verifyTokenFromRequest } from '@/lib/auth'
import { randomBytes } from 'node:crypto';
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server';
import { uploadScreenshot, getScreenshot, deleteScreenshot } from '@/lib/mediaStorage';
import { isWithinOfficeHours } from '@/lib/officeHours';
import { processImage, ImagePipelineError } from '@/lib/imagePipeline';
import { getDateKeyInTimezone } from '@/lib/timezone';
import { isScreenCaptureProtectedRole } from '@/lib/productivityPrivacy';
import { canViewTenantScreenshots } from '@/lib/productivityPermissions';
import { getProductivitySettings } from '@/lib/productivitySettings.server';

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/activity/screenshot
 * Upload a screenshot to private Vercel Blob with tenant-scoped Firestore metadata.
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await verifyTokenFromRequest(request);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, tenant } = auth;
    const store = await getFirestoreTenantDatabase(tenant.databaseName, { queryFields: { employees: ['email'], screenshots: ['user', 'capturedAt', 'captureType'] } });

    const userId = user._id || user.userId;
    const userRole = user.role;

    // Admin and HR screens contain privileged employee data and must never be captured.
    if (isScreenCaptureProtectedRole(userRole)) {
      return NextResponse.json({
        success: false,
        error: 'Screenshot capture is disabled for protected roles'
      }, { status: 403 });
    }

    // Enforce policy before reading image bytes or writing to Blob.
    if (!(await getProductivitySettings(store)).screenshotsEnabled) {
      return NextResponse.json({ success: true, dropped: true, captureEnabled: false, reason: 'screenshots_disabled', message: 'Screenshot capture is disabled by your administrator' });
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
    const rawBuffer = Buffer.from(arrayBuffer);

    // Run through unified image pipeline: enforces size cap, strips EXIF,
    // resizes to screenshot bounds, converts to WebP for storage savings.
    let buffer;
    let processedFormat = 'webp';
    let processedMime = 'image/webp';
    let processedWidth = 1920;
    let processedHeight = 1080;
    try {
      const processed = await processImage(rawBuffer, { type: 'screenshot' });
      buffer = processed.buffer;
      processedFormat = processed.format;
      processedMime = processed.mimeType;
      processedWidth = processed.width || processedWidth;
      processedHeight = processed.height || processedHeight;
    } catch (pipelineErr) {
      if (pipelineErr instanceof ImagePipelineError && pipelineErr.code === 'too_large') {
        return NextResponse.json({
          success: false,
          error: 'Screenshot exceeds maximum allowed size',
          meta: pipelineErr.meta,
        }, { status: 413 });
      }
      console.warn('[Screenshot] Pipeline failed, storing raw buffer:', pipelineErr?.message || pipelineErr);
      buffer = rawBuffer;
      processedMime = file.type || 'image/png';
      processedFormat = (processedMime.split('/')[1] || 'png').toLowerCase();
    }

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
    const userRecord = await store.get('users', String(userId));
    let employee = null;
    let employeeId = userRecord?.employeeId;

    if (employeeId) {
      employee = await store.get('employees', String(employeeId));
    }

    if (!employee && userRecord?.email) {
      employee = (await store.list('employees', { filters: [{ field: 'email', operator: '==', value: userRecord.email.toLowerCase() }], limit: 1 })).records[0];
      if (employee) {
        employeeId = employee._id;
      }
    }

    // Determine file format from processed buffer (WebP after pipeline).
    const mimeType = processedMime;
    const format = processedFormat;

    const capturedAt = requestedTimestamp ? new Date(requestedTimestamp) : new Date()
    const safeCapturedAt = Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt
    const dateString = getDateKeyInTimezone(safeCapturedAt);
    const timestamp = safeCapturedAt.getTime();
    const employeeCode = employee?.employeeCode || 'UNKNOWN';
    const filename = `screenshot_${employeeCode}_${timestamp}.webp`;

    // Office-hours gate: drop captures taken outside the company's working window.
    // Manual admin captures (`captureType=manual`) bypass this gate.
    let company = null;
    if (captureType !== 'manual') {
      try {
        company = (await store.list('companies', { limit: 1 })).records[0] || null;
        const officeCheck = isWithinOfficeHours(safeCapturedAt, company);
        if (!officeCheck.allowed) {
          console.log(
            `[Screenshot] ⏭️ Outside office hours (${officeCheck.reason}) for user ${userId} at ${safeCapturedAt.toISOString()}`
          );
          return NextResponse.json({
            success: true,
            dropped: true,
            reason: officeCheck.reason,
            message: 'Capture outside configured office hours',
            timestamp: safeCapturedAt.toISOString(),
          });
        }
      } catch (officeErr) {
        console.warn('[Screenshot] Office-hours check failed (allowing):', officeErr.message);
      }
    }

    // Only deduplicate true retry uploads around the same capture timestamp.
    const duplicateWindowMs = 15 * 1000
    const duplicateWindowStart = new Date(safeCapturedAt.getTime() - duplicateWindowMs)
    const duplicateWindowEnd = new Date(safeCapturedAt.getTime() + duplicateWindowMs)
    const existingDuplicate = (await store.list('screenshots', { filters: [
      { field: 'user', operator: '==', value: String(userId) },
      { field: 'capturedAt', operator: '>=', value: duplicateWindowStart },
      { field: 'capturedAt', operator: '<=', value: duplicateWindowEnd },
      { field: 'captureType', operator: '==', value: captureType },
    ], limit: 1 })).records[0];

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

    const publicPath = '';
    let storedMedia = null;

    // === PRIVATE BLOB STORAGE (primary - for long-term storage & AI analysis) ===
    try {
      storedMedia = await uploadScreenshot(buffer, {
        databaseName: tenant.databaseName,
        userId,
        employeeId: employeeId?.toString(),
        capturedAt: safeCapturedAt,
        sessionId,
        mimeType,
        format,
        width: processedWidth,
        height: processedHeight,
        activity
      });
      console.log(`[Screenshot] ✅ Uploaded to private Blob: ${storedMedia._id}`);
    } catch (storageError) {
      console.error('[Screenshot] ❌ Private Blob upload failed:', storageError.message);
    }

    if (!storedMedia) {
      return NextResponse.json({ success: false, message: 'Screenshot storage is unavailable. Please retry.' }, { status: 503 });
    }

    // === DATABASE RECORD ===
    const screenshot = {
      _id: randomBytes(12).toString('hex'),
      user: String(userId),
      employee: employeeId ? String(employeeId) : null,
      gridfsFileId: storedMedia?._id || null,
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
        storage: 'vercel-blob'
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
      sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try { await store.create('screenshots', screenshot); }
    catch (error) { await deleteScreenshot(storedMedia._id, { databaseName: tenant.databaseName }).catch(() => {}); throw error; }

    console.log(`[Screenshot] Saved for user ${userId}: ${screenshot._id}${storedMedia ? ` (Blob: ${storedMedia._id})` : ''}`);

    return NextResponse.json({
      success: true,
      screenshotId: screenshot._id.toString(),
      gridfsId: storedMedia?._id?.toString() || null,
      path: publicPath,
      timestamp: safeCapturedAt.toISOString(),
      fileSize: buffer.length,
      storage: 'vercel-blob'
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
 * Retrieve a private Blob screenshot by its tenant-scoped media ID
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await verifyTokenFromRequest(request);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user } = auth;
    const store = await getFirestoreTenantDatabase(auth.tenant.databaseName, { queryFields: { screenshots: ['gridfsFileId'] } });

    const userId = user._id || user.userId;
    const userRole = user.role;

    const { searchParams } = new URL(request.url);
    const screenshotId = searchParams.get('id');
    const fileId = searchParams.get('fileId');

    if (!screenshotId && !fileId) {
      return NextResponse.json({
        success: false,
        error: 'Screenshot ID or file ID required'
      }, { status: 400 });
    }

    if (screenshotId && !/^[a-f0-9]{24}$/i.test(screenshotId)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid screenshot ID format'
      }, { status: 400 });
    }

    if (fileId && !/^[a-f0-9]{24}$/i.test(fileId)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid file ID format'
      }, { status: 400 });
    }

    // Get screenshot metadata
    const screenshot = screenshotId
      ? await store.get('screenshots', screenshotId)
      : (await store.list('screenshots', { filters: [{ field: 'gridfsFileId', operator: '==', value: fileId }], limit: 1 })).records[0];

    if (!screenshot) {
      return NextResponse.json({
        success: false,
        error: 'Screenshot not found'
      }, { status: 404 });
    }

    // Access control - check if user can view this screenshot
    const hasAccess = await canViewTenantScreenshots(userId, screenshot.user, userRole, auth.tenant.databaseName);

    if (!hasAccess) {
      return NextResponse.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 });
    }

    // The historical field stores a native media descriptor ID; no legacy database is consulted.
    if (!screenshot.gridfsFileId) {
      return NextResponse.json({
        success: false,
        error: 'Screenshot image not available'
      }, { status: 404 });
    }

    const imageBuffer = await getScreenshot(screenshot.gridfsFileId, {
      databaseName: auth.tenant.databaseName,
    });

    // Return image
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': screenshot.metadata?.mimeType || 'image/png',
        'Content-Length': imageBuffer.length.toString(),
        'Cache-Control': 'private, no-store'
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
