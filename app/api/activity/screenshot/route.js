import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { writeFile, mkdir, access, constants } from 'fs/promises';
import path from 'path';
import { optimizeScreenshot } from '@/lib/imageOptimization';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import ProductivitySession from '@/models/ProductivitySession';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// Roles that are restricted from having their screens captured
const RESTRICTED_ROLES = ['admin', 'god_admin'];

/**
 * Ensure directory exists with proper permissions
 */
async function ensureDirectory(dirPath) {
  try {
    await access(dirPath, constants.W_OK);
    return true;
  } catch {
    try {
      await mkdir(dirPath, { recursive: true, mode: 0o755 });
      console.log(`[Screenshot] Created directory: ${dirPath}`);
      return true;
    } catch (mkdirError) {
      console.error(`[Screenshot] Failed to create directory ${dirPath}:`, mkdirError.message);
      return false;
    }
  }
}

/**
 * POST /api/activity/screenshot
 * Receive and save screenshots from desktop app
 * Saves to: public/activity/{userId}/{date}/{timestamp}.webp
 * Enforces role-based restrictions
 */
export async function POST(request) {
  const startTime = Date.now();
  
  try {
    // Verify JWT token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[Screenshot] Missing or invalid authorization header');
      return NextResponse.json(
        { error: 'Unauthorized - No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    
    let decoded;
    try {
      decoded = await jwtVerify(token, JWT_SECRET);
    } catch (jwtError) {
      console.log('[Screenshot] JWT verification failed:', jwtError.message);
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      );
    }
    
    const userId = decoded.payload.userId;
    const userRole = decoded.payload.role;

    if (!userId) {
      console.log('[Screenshot] No userId in token');
      return NextResponse.json(
        { error: 'Unauthorized - User not found' },
        { status: 401 }
      );
    }

    // CRITICAL: Check if user's role is restricted from capture
    if (RESTRICTED_ROLES.includes(userRole)) {
      console.log(`[Screenshot] BLOCKED - User role '${userRole}' is restricted from capture`);
      return NextResponse.json(
        { error: 'Screen capture is disabled for admin accounts', restricted: true },
        { status: 403 }
      );
    }

    let screenshot, timestamp, sessionId, sessionNumber, captureType, isOfflineCapture;
    const contentType = request.headers.get('content-type') || '';

    // Handle both FormData and JSON body
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      screenshot = formData.get('screenshot');
      timestamp = formData.get('timestamp') || Date.now().toString();
      sessionId = formData.get('sessionId');
      sessionNumber = formData.get('sessionNumber');
      captureType = formData.get('captureType') || 'automatic';
      isOfflineCapture = formData.get('isOfflineCapture') === 'true';
    } else {
      const body = await request.json();
      screenshot = body.screenshot;
      timestamp = body.timestamp || Date.now().toString();
      sessionId = body.sessionId;
      sessionNumber = body.sessionNumber;
      captureType = body.captureType || 'automatic';
      isOfflineCapture = body.isOfflineCapture || false;
    }

    if (!screenshot) {
      console.log('[Screenshot] No screenshot data in request');
      return NextResponse.json(
        { error: 'Screenshot data required' },
        { status: 400 }
      );
    }

    // Create date folder structure: YYYY-MM-DD
    const date = new Date(parseInt(timestamp));
    const dateFolder = date.toISOString().split('T')[0];
    const timeString = date.toISOString().replace(/[:.]/g, '-');

    // Define the save path: public/activity/{userId}/{date}/
    const publicDir = path.join(process.cwd(), 'public');
    const activityBaseDir = path.join(publicDir, 'activity');
    const userDir = path.join(activityBaseDir, userId);
    const activityDir = path.join(userDir, dateFolder);
    
    // Ensure all directories exist
    const dirCreated = await ensureDirectory(activityDir);
    if (!dirCreated) {
      return NextResponse.json(
        { error: 'Failed to create activity directory' },
        { status: 500 }
      );
    }

    // Determine file extension based on content type
    let fileName;
    let buffer;
    
    if (screenshot instanceof File) {
      buffer = Buffer.from(await screenshot.arrayBuffer());
      fileName = `${timeString}.webp`;
    } else if (typeof screenshot === 'string') {
      // Handle base64 data
      const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');
      buffer = Buffer.from(base64Data, 'base64');
      fileName = `${timeString}.webp`;
    } else {
      console.log('[Screenshot] Invalid screenshot format:', typeof screenshot);
      return NextResponse.json(
        { error: 'Invalid screenshot format' },
        { status: 400 }
      );
    }

    // Optimize screenshot for storage (compress to webp)
    const originalSize = buffer.length;
    try {
      buffer = await optimizeScreenshot(buffer);
      console.log(`[Screenshot] Optimized: ${(originalSize / 1024).toFixed(1)}KB -> ${(buffer.length / 1024).toFixed(1)}KB (${((1 - buffer.length / originalSize) * 100).toFixed(0)}% saved)`);
    } catch (optError) {
      console.warn('[Screenshot] Optimization failed, using original:', optError.message);
    }

    const filePath = path.join(activityDir, fileName);

    // Write the file
    try {
      await writeFile(filePath, buffer);
    } catch (writeError) {
      console.error('[Screenshot] Failed to write file:', writeError.message);
      return NextResponse.json(
        { error: 'Failed to save screenshot file', details: writeError.message },
        { status: 500 }
      );
    }

    // Return the relative URL path
    const relativePath = `/activity/${userId}/${dateFolder}/${fileName}`;
    const elapsed = Date.now() - startTime;

    console.log(`[Screenshot] ✓ Saved: ${relativePath} (${(buffer.length / 1024).toFixed(1)}KB, ${elapsed}ms)`);

    // Update or create session in database
    try {
      await connectDB();
      
      const user = await User.findById(userId).select('employeeId');
      const dateObj = new Date(parseInt(timestamp));
      const dateStart = new Date(dateObj);
      dateStart.setHours(0, 0, 0, 0);
      const dateEnd = new Date(dateObj);
      dateEnd.setHours(23, 59, 59, 999);
      
      // Find or create session
      let session = await ProductivitySession.findOne({
        user: userId,
        date: { $gte: dateStart, $lte: dateEnd },
        sessionNumber: sessionNumber ? parseInt(sessionNumber) : 1
      });
      
      if (!session) {
        // Create new session
        session = new ProductivitySession({
          user: userId,
          employee: user?.employeeId,
          date: dateStart,
          sessionNumber: sessionNumber ? parseInt(sessionNumber) : 1,
          screenshots: [],
          startTime: dateObj,
          endTime: dateObj
        });
      }
      
      // Add screenshot to session
      session.screenshots.push({
        path: relativePath,
        timestamp: dateObj,
        filename: fileName,
        captureType: captureType || 'automatic',
        isOfflineCapture: isOfflineCapture || false
      });
      
      session.endTime = dateObj;
      await session.save();
      
    } catch (dbError) {
      console.error('[Screenshot] Database update error:', dbError.message);
      // Don't fail the request - file was saved successfully
    }

    return NextResponse.json({
      success: true,
      message: 'Screenshot saved successfully',
      path: relativePath,
      timestamp: date.toISOString(),
      userId,
      size: buffer.length,
      sessionId,
      captureType
    });

  } catch (error) {
    console.error('[Screenshot] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Failed to save screenshot', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/activity/screenshot
 * Check if screenshots are enabled and get info
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
      decoded = await jwtVerify(token, JWT_SECRET);
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const userId = decoded.payload.userId;
    const activityDir = path.join(process.cwd(), 'public', 'activity', userId);
    
    // Check if user directory exists
    let dirExists = false;
    try {
      await access(activityDir, constants.R_OK);
      dirExists = true;
    } catch {
      dirExists = false;
    }

    return NextResponse.json({
      success: true,
      enabled: true,
      userId,
      activityDir: `/activity/${userId}`,
      dirExists
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get screenshot info', details: error.message },
      { status: 500 }
    );
  }
}
