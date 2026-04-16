import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

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
    if (!interval || interval < 1 || interval > 1440) {
      return NextResponse.json({
        success: false,
        error: 'Invalid interval. Must be between 1 and 1440 minutes'
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

    const interval = userRecord.settings?.screenshotInterval || 3; // Default 3 minutes

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
