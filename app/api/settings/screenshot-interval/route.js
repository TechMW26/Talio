import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-key');

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
      const result = await jwtVerify(token, JWT_SECRET);
      decoded = result.payload;
    } catch (err) {
      return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
    }

    const userId = decoded.userId;
    const { interval } = await request.json();

    await connectDB();

    const user = await User.findById(userId).select('role');
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

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
    await User.findByIdAndUpdate(userId, {
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
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
      const result = await jwtVerify(token, JWT_SECRET);
      decoded = result.payload;
    } catch (err) {
      return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
    }

    const userId = decoded.userId;

    await connectDB();

    const user = await User.findById(userId).select('settings');
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const interval = user.settings?.screenshotInterval || 5; // Default 5 minutes

    return NextResponse.json({
      success: true,
      interval,
      updatedAt: user.settings?.screenshotIntervalUpdatedAt
    });

  } catch (error) {
    console.error('Get Screenshot Interval Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to get screenshot interval setting' 
    }, { status: 500 });
  }
}
