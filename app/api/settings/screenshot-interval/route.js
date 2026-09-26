import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { SCREENSHOT_CAPTURE_INTERVAL_MINUTES } from '@/lib/productivitySessionRules';

export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User } = models

    const { interval } = await request.json();

    // Only admin, admin, and department_head can set screenshot interval
    if (!['admin', 'department_head'].includes(user.role)) {
      return NextResponse.json({
        success: false,
        error: 'Insufficient permissions'
      }, { status: 403 });
    }

    // Validate interval
    if (interval !== SCREENSHOT_CAPTURE_INTERVAL_MINUTES) {
      return NextResponse.json({
        success: false,
        error: 'Screenshot capture is fixed at 4 minutes for all employees'
      }, { status: 400 });
    }

    // Update user's screenshot interval setting
    await User.findByIdAndUpdate(user._id || user.userId, {
      $set: {
        'settings.screenshotInterval': interval,
        'settings.screenshotIntervalUpdatedAt': new Date()
      }
    });

    return NextResponse.json({
      success: true,
      message: `Screenshot interval set to ${interval} minutes`,
      interval
    });

  } catch (error) {
    console.error('Screenshot Interval Setting Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to save screenshot interval setting'
    }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User } = models

    const userRecord = await User.findById(user._id || user.userId).select('settings');
    if (!userRecord) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Old per-user values must not override the organization-wide capture policy.
    const interval = SCREENSHOT_CAPTURE_INTERVAL_MINUTES;

    return NextResponse.json({
      success: true,
      interval,
      updatedAt: userRecord.settings?.screenshotIntervalUpdatedAt
    });

  } catch (error) {
    console.error('Get Screenshot Interval Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to get screenshot interval setting'
    }, { status: 500 });
  }
}
