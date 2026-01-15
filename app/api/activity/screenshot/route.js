import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth'
import { mkdir, writeFile, access, constants, unlink } from 'fs/promises';
import path from 'path';
import { uploadScreenshot, getScreenshot } from '@/lib/gridfs';
import { uploadImageToImageKit, getImageKitFolder, generateEmployeeFolderName } from '@/lib/imagekit';
import mongoose from 'mongoose';

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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Screenshot']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { User, Employee, Screenshot } = models;

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
 * Retrieve a screenshot image by ID (from GridFS or ImageKit)
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

    // If ImageKit URL exists, redirect to it
    if (screenshot.imagekitUrl) {
      return NextResponse.redirect(screenshot.imagekitUrl);
    }

    // Otherwise, get from GridFS
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
