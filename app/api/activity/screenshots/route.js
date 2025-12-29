import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth'

/**
 * Check if a user is a department head who can view another user's screenshots
 * @param {Object} models - Tenant models (User, Employee, Department)
 */
async function canViewUserScreenshots(viewerId, targetUserId, viewerRole, models) {
  const { User, Employee, Department } = models;
  
  // Admins and HR can view all
  if (['admin', 'hr'].includes(viewerRole)) {
    return true;
  }

  // Same user
  if (viewerId === targetUserId) {
    return true;
  }

  // Check if viewer is department head of target's department
  const viewer = await User.findById(viewerId).select('employeeId');
  const target = await User.findById(targetUserId).select('employeeId');

  if (!viewer?.employeeId || !target?.employeeId) {
    return false;
  }

  const viewerEmployee = await Employee.findById(viewer.employeeId).select('_id');
  const targetEmployee = await Employee.findById(target.employeeId).select('department departments');

  if (!viewerEmployee || !targetEmployee) {
    return false;
  }

  // Get all departments the target belongs to
  const targetDepartments = [];
  if (targetEmployee.department) {
    targetDepartments.push(targetEmployee.department);
  }
  if (targetEmployee.departments?.length) {
    targetDepartments.push(...targetEmployee.departments);
  }

  // Check if viewer is head of any of those departments
  const departments = await Department.find({
    _id: { $in: targetDepartments },
    $or: [
      { head: viewerEmployee._id },
      { heads: viewerEmployee._id }
    ]
  });

  return departments.length > 0;
}

/**
 * GET /api/activity/screenshots
 * List screenshots for a user
 * 
 * Query params:
 * - userId: Target user ID (optional, defaults to current user)
 * - date: Date string YYYY-MM-DD (optional, defaults to today)
 * - startDate: Start date for range query
 * - endDate: End date for range query
 * - limit: Max results (default 100)
 * - skip: Pagination offset
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Department', 'Screenshot'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee, Department, Screenshot } = models

    const viewerId = user._id || user.userId;
    const viewerRole = user.role;

    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId') || viewerId;
    const date = searchParams.get('date');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = Math.min(parseInt(searchParams.get('limit')) || 100, 500);
    const skip = parseInt(searchParams.get('skip')) || 0;

    // Check access permission
    const canView = await canViewUserScreenshots(viewerId, targetUserId, viewerRole, models);
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
      query.capturedAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate + 'T23:59:59.999Z')
      };
    } else if (startDate) {
      query.capturedAt = { $gte: new Date(startDate) };
    } else if (endDate) {
      query.capturedAt = { $lte: new Date(endDate + 'T23:59:59.999Z') };
    }

    // Get screenshots
    const screenshots = await Screenshot.find(query)
      .sort({ capturedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-gridfsFileId') // Don't expose GridFS ID directly
      .lean();

    const total = await Screenshot.countDocuments(query);

    // Get user info for context
    const targetUser = await User.findById(targetUserId).select('name email');

    return NextResponse.json({
      success: true,
      screenshots: screenshots.map(s => ({
        id: s._id.toString(),
        capturedAt: s.capturedAt,
        dateString: s.dateString,
        formattedTime: new Date(s.capturedAt).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }),
        activity: s.activity,
        metadata: {
          mimeType: s.metadata?.mimeType,
          width: s.metadata?.width,
          height: s.metadata?.height,
          fileSize: s.metadata?.fileSize
        },
        sessionId: s.sessionId,
        // URL to fetch the actual image
        imageUrl: `/api/activity/screenshot?id=${s._id}`
      })),
      pagination: {
        total,
        limit,
        skip,
        hasMore: skip + screenshots.length < total
      },
      user: targetUser ? {
        id: targetUser._id.toString(),
        name: targetUser.name,
        email: targetUser.email
      } : null
    });

  } catch (error) {
    console.error('[Screenshots] List error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
