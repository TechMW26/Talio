import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { writeFile, mkdir, access, constants } from 'fs/promises';
import path from 'path';
import { optimizeScreenshot } from '@/lib/imageOptimization';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

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

    if (!userId) {
      console.log('[Screenshot] No userId in token');
      return NextResponse.json(
        { error: 'Unauthorized - User not found' },
        { status: 401 }
      );
    }

    let screenshot, timestamp;
    const contentType = request.headers.get('content-type') || '';

    // Handle both FormData and JSON body
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      screenshot = formData.get('screenshot');
      timestamp = formData.get('timestamp') || Date.now().toString();
    } else {
      const body = await request.json();
      screenshot = body.screenshot;
      timestamp = body.timestamp || Date.now().toString();
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

    return NextResponse.json({
      success: true,
      message: 'Screenshot saved successfully',
      path: relativePath,
      timestamp: date.toISOString(),
      userId,
      size: buffer.length
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
