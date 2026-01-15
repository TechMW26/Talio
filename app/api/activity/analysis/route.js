import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth'
import { triggerScheduledTasks, analyzeUserDay } from '@/lib/screenshotAnalysis';
import mongoose from 'mongoose';

/**
 * Check if viewer can access target user's analysis
 * @param {Object} models - Tenant models (User, Employee, Department)
 */
async function canViewAnalysis(viewerId, targetUserId, viewerRole, models) {
  const { User, Employee, Department } = models;
  
  if (['admin', 'hr'].includes(viewerRole)) {
    return true;
  }

  if (viewerId === targetUserId) {
    return true;
  }

  // Check department head access
  const viewer = await User.findById(viewerId).select('employeeId');
  const target = await User.findById(targetUserId).select('employeeId');

  if (!viewer?.employeeId || !target?.employeeId) {
    return false;
  }

  const targetEmployee = await Employee.findById(target.employeeId).select('department departments');
  if (!targetEmployee) return false;

  const targetDepartments = [];
  if (targetEmployee.department) targetDepartments.push(targetEmployee.department);
  if (targetEmployee.departments?.length) targetDepartments.push(...targetEmployee.departments);

  const departments = await Department.find({
    _id: { $in: targetDepartments },
    $or: [
      { head: viewer.employeeId },
      { heads: viewer.employeeId }
    ]
  });

  return departments.length > 0;
}

/**
 * GET /api/activity/analysis
 * Get screenshot analysis for a user
 * 
 * Query params:
 * - userId: Target user ID (optional, defaults to current user)
 * - date: Date string YYYY-MM-DD (optional, defaults to yesterday)
 * - startDate: Start date for range query
 * - endDate: End date for range query
 */
export async function GET(request) {
  try {
    // Trigger scheduled tasks (cleanup, daily analysis)
    triggerScheduledTasks().catch(err => console.error('[Analysis] Scheduler error:', err));

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Department', 'ScreenshotAnalysis'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee, Department, ScreenshotAnalysis } = models

    const viewerId = user._id || user.userId;
    const viewerRole = user.role;

    if (!viewerId) {
      return NextResponse.json({ success: false, error: 'User ID not found' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId') || viewerId;
    const date = searchParams.get('date');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Validate userId format if provided
    if (targetUserId && targetUserId !== viewerId && !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return NextResponse.json({ success: false, error: 'Invalid user ID format' }, { status: 400 });
    }

    // Check access
    const canView = await canViewAnalysis(viewerId, targetUserId, viewerRole, models);
    if (!canView) {
      return NextResponse.json({ 
        success: false, 
        error: 'Access denied' 
      }, { status: 403 });
    }

    // Build query
    const query = { user: targetUserId };

    if (date) {
      query.dateString = date;
    } else if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate + 'T23:59:59.999Z')
      };
    } else if (startDate) {
      query.date = { $gte: new Date(startDate) };
    } else if (endDate) {
      query.date = { $lte: new Date(endDate + 'T23:59:59.999Z') };
    } else {
      // Default to yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      query.dateString = yesterday.toISOString().split('T')[0];
    }

    // Get analyses
    const analyses = await ScreenshotAnalysis.find(query)
      .sort({ date: -1 })
      .limit(30)
      .lean();

    // Get user info
    const targetUser = await User.findById(targetUserId).select('name email');

    return NextResponse.json({
      success: true,
      analyses: analyses.map(a => ({
        id: a._id.toString(),
        dateString: a.dateString,
        formattedDate: a.date ? new Date(a.date).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }) : a.dateString,
        status: a.status,
        screenshotCount: a.screenshotCount,
        totalActiveMinutes: a.totalActiveMinutes,
        workDuration: a.totalActiveMinutes ? `${Math.floor(a.totalActiveMinutes / 60)}h ${a.totalActiveMinutes % 60}m` : null,
        firstCapture: a.firstCapture,
        lastCapture: a.lastCapture,
        employeeContext: a.employeeContext,
        timeline: a.timeline,
        summary: a.summary,
        metrics: a.metrics,
        applicationUsage: a.applicationUsage,
        categoryBreakdown: a.categoryBreakdown,
        hourlyActivity: a.hourlyActivity,
        analyzedAt: a.analyzedAt,
        aiModel: a.aiModel,
        error: a.error
      })),
      user: targetUser ? {
        id: targetUser._id.toString(),
        name: targetUser.name,
        email: targetUser.email
      } : null
    });

  } catch (error) {
    console.error('[Analysis] GET error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

/**
 * POST /api/activity/analysis
 * Trigger analysis for a specific user and date
 * 
 * Body:
 * - userId: Target user ID (optional, defaults to current user)
 * - date: Date string YYYY-MM-DD (required)
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, []);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user } = auth;

    const viewerId = user._id || user.userId;
    const viewerRole = user.role;

    // Only admins can trigger analysis manually
    if (!['admin', 'hr'].includes(viewerRole)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Admin access required' 
      }, { status: 403 });
    }

    const body = await request.json();
    const targetUserId = body.userId || viewerId;
    const dateString = body.date;

    if (!dateString) {
      return NextResponse.json({ 
        success: false, 
        error: 'Date is required' 
      }, { status: 400 });
    }

    ;

    // Run analysis
    const analysis = await analyzeUserDay(targetUserId, dateString);

    if (!analysis) {
      return NextResponse.json({
        success: false,
        error: 'No screenshots found for the specified date'
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      analysis: {
        id: analysis._id.toString(),
        dateString: analysis.dateString,
        status: analysis.status,
        screenshotCount: analysis.screenshotCount,
        totalActiveMinutes: analysis.totalActiveMinutes,
        metrics: analysis.metrics,
        summary: analysis.summary,
        analyzedAt: analysis.analyzedAt,
        processingTime: analysis.processingTime
      }
    });

  } catch (error) {
    console.error('[Analysis] POST error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
