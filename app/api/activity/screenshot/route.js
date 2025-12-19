import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import connectDB from '@/lib/mongodb';
import { uploadScreenshot } from '@/lib/gridfs';
import Screenshot from '@/models/Screenshot';
import User from '@/models/User';
import Employee from '@/models/Employee';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

/**
 * POST /api/activity/screenshot
 * Upload a screenshot to GridFS and create metadata record
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
    if (['admin', 'god_admin'].includes(userRole)) {
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

    // Get employee info
    const user = await User.findById(userId).select('employeeId name email');
    let employeeId = user?.employeeId;
    
    if (!employeeId && user?.email) {
      const employee = await Employee.findOne({ email: user.email.toLowerCase() });
      if (employee) {
        employeeId = employee._id;
      }
    }

    // Determine file format from content type
    const mimeType = file.type || 'image/png';
    const format = mimeType.split('/')[1] || 'png';
    
    const now = new Date();
    const dateString = now.toISOString().split('T')[0];

    // Upload to GridFS
    const gridfsResult = await uploadScreenshot(buffer, {
      userId,
      employeeId: employeeId?.toString(),
      capturedAt: now,
      sessionId,
      mimeType,
      format,
      width: 1920, // Expected 1080p
      height: 1080,
      activity
    });

    // Create screenshot metadata record
    const screenshot = new Screenshot({
      user: userId,
      employee: employeeId,
      gridfsFileId: gridfsResult._id,
      capturedAt: now,
      dateString,
      metadata: {
        mimeType,
        width: 1920,
        height: 1080,
        fileSize: buffer.length,
        format
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

    console.log(`[Screenshot] Saved for user ${userId}: ${screenshot._id} (GridFS: ${gridfsResult._id})`);

    return NextResponse.json({
      success: true,
      screenshotId: screenshot._id.toString(),
      gridfsId: gridfsResult._id.toString(),
      timestamp: now.toISOString(),
      fileSize: buffer.length
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
 * Retrieve a screenshot image by ID
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

    // Access control: user can only view their own screenshots unless admin/manager
    if (!['admin', 'god_admin', 'hr', 'manager'].includes(userRole)) {
      if (screenshot.user.toString() !== userId) {
        // Check if viewer is department head of screenshot owner
        const { isDepartmentHead } = await import('@/app/api/activity/captures/route.js');
        const isHead = await isDepartmentHead(userId, screenshot.user.toString());
        
        if (!isHead) {
          return NextResponse.json({ 
            success: false, 
            error: 'Access denied' 
          }, { status: 403 });
        }
      }
    }

    // Get image from GridFS
    const { getScreenshot } = await import('@/lib/gridfs');
    const imageBuffer = await getScreenshot(screenshot.gridfsFileId);

    // Return image with proper content type
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': screenshot.metadata.mimeType || 'image/png',
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
