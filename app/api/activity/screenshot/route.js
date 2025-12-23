import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { mkdir, writeFile, access, constants, unlink } from 'fs/promises';
import path from 'path';
import connectDB from '@/lib/mongodb';
import { uploadScreenshot, getScreenshot } from '@/lib/gridfs';
import { uploadImageToImageKit, getImageKitFolder, generateEmployeeFolderName } from '@/lib/imagekit';
import Screenshot from '@/models/Screenshot';
import User from '@/models/User';
import Employee from '@/models/Employee';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// Check if ImageKit is configured
const isImageKitConfigured = () => {
  return !!(
    process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT
  )
}

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
    // Verify JWT
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({
        success: false,
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
        error: 'Invalid token'
      }, { status: 401 });
    }

    const userId = decoded.payload.userId;
    const userRole = decoded.payload.role;

    // Skip for admin roles
    if (['admin'].includes(userRole)) {
      return NextResponse.json({
        success: false,
        error: 'Screenshot capture not enabled for admin roles'
      }, { status: 400 });
    }

    await connectDB();

    // Get form data
    const formData = await request.formData();
    const file = formData.get('screenshot');
    const activityData = formData.get('activity');
    const sessionId = formData.get('sessionId');

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
    const user = await User.findById(userId).select('employeeId name email');
    let employee = null;
    let employeeId = user?.employeeId;

    if (employeeId) {
      employee = await Employee.findById(employeeId).select('firstName lastName employeeCode');
    }

    if (!employee && user?.email) {
      employee = await Employee.findOne({ email: user.email.toLowerCase() }).select('firstName lastName employeeCode');
      if (employee) {
        employeeId = employee._id;
      }
    }

    // Determine file format from content type
    const mimeType = file.type || 'image/png';
    const format = mimeType.split('/')[1] || 'png';

    const now = new Date();
    const dateString = now.toISOString().split('T')[0];
    const timestamp = now.getTime();
    const employeeCode = employee?.employeeCode || 'UNKNOWN';
    const filename = `screenshot_${employeeCode}_${timestamp}.webp`;

    // Get the appropriate ImageKit folder with employee subfolder
    const imagekitFolder = getImageKitFolder('screenshot', { employee, dateString });
    const employeeFolderName = generateEmployeeFolderName(employee);

    let publicPath = '';
    let imagekitFileId = null;
    let imagekitUrl = null;
    let gridfsResult = null;

    // === IMAGEKIT STORAGE (primary - CDN delivery) ===
    if (isImageKitConfigured()) {
      try {
        console.log('[Screenshot] Attempting ImageKit upload...');
        console.log('[Screenshot] Folder:', imagekitFolder);
        console.log('[Screenshot] Buffer size:', buffer.length, 'bytes');

        // Use uploadImageToImageKit directly (no temp file) - works better in serverless/Docker
        const imagekitResult = await uploadImageToImageKit(buffer, {
          fileName: filename,
          folder: imagekitFolder,
          tags: ['screenshot', 'productivity', dateString, employeeCode],
          useUniqueFileName: true,
        });

        imagekitUrl = imagekitResult.url;
        imagekitFileId = imagekitResult.fileId;
        publicPath = imagekitUrl;
        console.log(`[Screenshot] ✅ Uploaded to ImageKit: ${imagekitUrl}`);
      } catch (imagekitError) {
        console.error('[Screenshot] ❌ ImageKit upload failed:');
        console.error('[Screenshot] Error name:', imagekitError.name);
        console.error('[Screenshot] Error message:', imagekitError.message);
        // Fall through to filesystem storage
      }
    } else {
      console.log('[Screenshot] ImageKit not configured, using filesystem storage');
    }

    // === FALLBACK: FILESYSTEM STORAGE (for dashboard display) ===
    if (!publicPath) {
      const activityDir = path.join(process.cwd(), 'public', 'activity', employeeFolderName, dateString);
      await ensureDirectory(activityDir);

      const filePath = path.join(activityDir, filename);
      await writeFile(filePath, buffer);

      publicPath = `/activity/${employeeFolderName}/${dateString}/${filename}`;
      console.log(`[Screenshot] Saved to filesystem: ${publicPath}`);
    }

    // === GRIDFS STORAGE (for long-term storage & AI analysis - fallback) ===
    // Only use GridFS if ImageKit is not configured
    if (!isImageKitConfigured()) {
      gridfsResult = await uploadScreenshot(buffer, {
        userId,
        employeeId: employeeId?.toString(),
        capturedAt: now,
        sessionId,
        mimeType,
        format,
        width: 1920,
        height: 1080,
        activity
      });
    }

    // === DATABASE RECORD ===
    const screenshot = new Screenshot({
      user: userId,
      employee: employeeId,
      gridfsFileId: gridfsResult?._id || null,
      imagekitFileId: imagekitFileId,
      imagekitUrl: imagekitUrl,
      capturedAt: now,
      dateString,
      // Add filesystem path for dashboard compatibility
      path: publicPath,
      filename,
      metadata: {
        mimeType,
        width: 1920,
        height: 1080,
        fileSize: buffer.length,
        format,
        storage: imagekitUrl ? 'imagekit' : (gridfsResult ? 'gridfs' : 'filesystem')
      },
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

    console.log(`[Screenshot] Saved for user ${userId}: ${screenshot._id}${imagekitUrl ? ` (ImageKit: ${imagekitFileId})` : (gridfsResult ? ` (GridFS: ${gridfsResult._id})` : '')}`);

    return NextResponse.json({
      success: true,
      screenshotId: screenshot._id.toString(),
      gridfsId: gridfsResult?._id?.toString() || null,
      imagekitFileId: imagekitFileId,
      imagekitUrl: imagekitUrl,
      path: publicPath,
      timestamp: now.toISOString(),
      fileSize: buffer.length,
      storage: imagekitUrl ? 'imagekit' : (gridfsResult ? 'gridfs' : 'filesystem')
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
 * Retrieve a screenshot image by ID (from GridFS)
 */
export async function GET(request) {
  try {
    // Verify JWT
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({
        success: false,
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
        error: 'Invalid token'
      }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const screenshotId = searchParams.get('id');

    if (!screenshotId) {
      return NextResponse.json({
        success: false,
        error: 'Screenshot ID required'
      }, { status: 400 });
    }

    await connectDB();

    // Get screenshot metadata
    const screenshot = await Screenshot.findById(screenshotId);
    if (!screenshot) {
      return NextResponse.json({
        success: false,
        error: 'Screenshot not found'
      }, { status: 404 });
    }

    const userId = decoded.payload.userId;
    const userRole = decoded.payload.role;

    // Access control
    if (!['admin', 'hr', 'manager'].includes(userRole)) {
      if (screenshot.user.toString() !== userId) {
        return NextResponse.json({
          success: false,
          error: 'Access denied'
        }, { status: 403 });
      }
    }

    // Get image from GridFS
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
