import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { writeFile, mkdir, access, constants } from 'fs/promises';
import path from 'path';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import ProductivitySession from '@/models/ProductivitySession';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// Roles that are restricted from having their screens captured
const RESTRICTED_ROLES = ['admin', 'god_admin'];

/**
 * Ensure directory exists recursively
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
      console.error(`[Screenshot] Failed to create directory:`, mkdirError.message);
      return false;
    }
  }
}

/**
 * Create activity folder structure for a user
 * Creates: public/activity/{userId}/
 */
async function createUserActivityFolder(userId) {
  const publicDir = path.join(process.cwd(), 'public');
  const activityBaseDir = path.join(publicDir, 'activity');
  const userDir = path.join(activityBaseDir, userId);
  
  await ensureDirectory(activityBaseDir);
  await ensureDirectory(userDir);
  
  return userDir;
}

/**
 * POST /api/activity/screenshot
 * Receive and save screenshots from desktop app
 * 
 * Storage: public/activity/{userId}/{YYYY-MM-DD}/{timestamp}.jpg
 * 
 * Accepts JPEG images (no WebP compression)
 * Auto-creates folder structure
 * Links to ProductivitySession in DB
 */
export async function POST(request) {
  const startTime = Date.now();
  
  try {
    // Verify JWT token
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
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
    const userRole = decoded.payload.role;

    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    // CRITICAL: Block restricted roles from capture
    if (RESTRICTED_ROLES.includes(userRole)) {
      console.log(`[Screenshot] BLOCKED - Role '${userRole}' is restricted`);
      return NextResponse.json(
        { error: 'Screen capture disabled for admin accounts', restricted: true },
        { status: 403 }
      );
    }

    // Parse request body
    let screenshot, timestamp, sessionId, sessionNumber, captureType, isOfflineCapture, originalFilename;
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      screenshot = formData.get('screenshot');
      timestamp = formData.get('timestamp') || Date.now().toString();
      sessionId = formData.get('sessionId');
      sessionNumber = formData.get('sessionNumber');
      captureType = formData.get('captureType') || 'automatic';
      isOfflineCapture = formData.get('isOfflineCapture') === 'true';
      originalFilename = formData.get('originalFilename');
    } else {
      const body = await request.json();
      screenshot = body.screenshot;
      timestamp = body.timestamp || Date.now().toString();
      sessionId = body.sessionId;
      sessionNumber = body.sessionNumber;
      captureType = body.captureType || 'automatic';
      isOfflineCapture = body.isOfflineCapture || false;
      originalFilename = body.originalFilename;
    }

    if (!screenshot) {
      return NextResponse.json({ error: 'Screenshot data required' }, { status: 400 });
    }

    // Parse timestamp
    const captureTime = new Date(parseInt(timestamp));
    if (isNaN(captureTime.getTime())) {
      return NextResponse.json({ error: 'Invalid timestamp' }, { status: 400 });
    }
    
    const dateFolder = captureTime.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeString = captureTime.toISOString().replace(/[:.]/g, '-');

    // Create directory structure: public/activity/{userId}/{date}/
    const publicDir = path.join(process.cwd(), 'public');
    const activityDir = path.join(publicDir, 'activity', userId, dateFolder);
    
    const dirCreated = await ensureDirectory(activityDir);
    if (!dirCreated) {
      return NextResponse.json({ error: 'Failed to create directory' }, { status: 500 });
    }

    // Convert screenshot to buffer
    let buffer;
    let fileExt = 'jpg';
    
    if (screenshot instanceof File) {
      buffer = Buffer.from(await screenshot.arrayBuffer());
      // Check MIME type
      if (screenshot.type === 'image/png') fileExt = 'png';
    } else if (typeof screenshot === 'string') {
      // Handle base64 data URL
      const matches = screenshot.match(/^data:image\/(\w+);base64,(.+)$/);
      if (matches) {
        fileExt = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        // Raw base64
        buffer = Buffer.from(screenshot, 'base64');
      }
    } else {
      return NextResponse.json({ error: 'Invalid screenshot format' }, { status: 400 });
    }

    // File name and path
    const fileName = `${timeString}.${fileExt}`;
    const filePath = path.join(activityDir, fileName);

    // Write file (no compression - save as-is)
    try {
      await writeFile(filePath, buffer);
    } catch (writeError) {
      console.error('[Screenshot] Write failed:', writeError.message);
      return NextResponse.json({ error: 'Failed to save file' }, { status: 500 });
    }

    const relativePath = `/activity/${userId}/${dateFolder}/${fileName}`;
    const elapsed = Date.now() - startTime;

    console.log(`[Screenshot] ✓ Saved: ${relativePath} (${(buffer.length / 1024).toFixed(1)}KB, ${elapsed}ms)`);

    // Update database
    try {
      await connectDB();
      
      const user = await User.findById(userId).select('employeeId');
      
      const dateStart = new Date(captureTime);
      dateStart.setHours(0, 0, 0, 0);
      const dateEnd = new Date(captureTime);
      dateEnd.setHours(23, 59, 59, 999);
      
      // Find or create session
      let session = await ProductivitySession.findOne({
        user: userId,
        date: { $gte: dateStart, $lte: dateEnd },
        sessionNumber: sessionNumber ? parseInt(sessionNumber) : 1
      });
      
      if (!session) {
        session = new ProductivitySession({
          user: userId,
          employee: user?.employeeId,
          date: dateStart,
          sessionNumber: sessionNumber ? parseInt(sessionNumber) : 1,
          screenshots: [],
          startTime: captureTime,
          endTime: captureTime
        });
      }
      
      // Add screenshot record
      session.screenshots.push({
        path: relativePath,
        timestamp: captureTime,
        filename: fileName,
        size: buffer.length,
        captureType: captureType || 'automatic',
        isOfflineCapture: isOfflineCapture || false
      });
      
      session.screenshotCount = session.screenshots.length;
      session.endTime = captureTime;
      
      // Mark complete if 30 captures
      if (session.screenshotCount >= 30) {
        session.isComplete = true;
      }
      
      await session.save();
      
      console.log(`[Screenshot] DB updated: session #${session.sessionNumber}, capture #${session.screenshotCount}`);
      
    } catch (dbError) {
      console.error('[Screenshot] DB error:', dbError.message);
      // Don't fail - file was saved
    }

    return NextResponse.json({
      success: true,
      path: relativePath,
      timestamp: captureTime.toISOString(),
      userId,
      size: buffer.length,
      sessionNumber,
      captureType
    });

  } catch (error) {
    console.error('[Screenshot] Error:', error);
    return NextResponse.json(
      { error: 'Failed to save screenshot', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/activity/screenshot
 * Get screenshot service status
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
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
    const userRole = decoded.payload.role;
    
    // Check if role is restricted
    const isRestricted = RESTRICTED_ROLES.includes(userRole);
    
    // Check if user directory exists
    const userDir = path.join(process.cwd(), 'public', 'activity', userId);
    let dirExists = false;
    try {
      await access(userDir, constants.R_OK);
      dirExists = true;
    } catch {
      dirExists = false;
    }

    return NextResponse.json({
      success: true,
      enabled: !isRestricted,
      restricted: isRestricted,
      userId,
      activityDir: `/activity/${userId}`,
      dirExists
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get status', details: error.message },
      { status: 500 }
    );
  }
}
