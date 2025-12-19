import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import connectDB from '@/lib/mongodb';
import CallAlert from '@/models/CallAlert';

/**
 * POST /api/call-alert/[id]/acknowledge
 * Acknowledge a received call alert
 */
export async function POST(request, { params }) {
  try {
    await connectDB();

    const { id } = await params;

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload: decoded } = await jwtVerify(token, secret);

    // Find the alert
    const alert = await CallAlert.findById(id);
    if (!alert) {
      return NextResponse.json(
        { success: false, message: 'Alert not found' },
        { status: 404 }
      );
    }

    // Check if user is a receiver
    const receiver = alert.receivers.find(
      r => r.user.toString() === decoded.userId
    );

    if (!receiver) {
      return NextResponse.json(
        { success: false, message: 'You are not a recipient of this alert' },
        { status: 403 }
      );
    }

    // Parse body for platform info
    const body = await request.json().catch(() => ({}));
    const { platform = 'web' } = body;

    // Acknowledge the alert
    await alert.acknowledgeAlert(decoded.userId);

    // Mark audio as played if provided
    if (body.audioPlayed && receiver.deliveryStatus[platform]) {
      await alert.markAudioPlayed(decoded.userId, platform);
    }

    // Notify sender that alert was acknowledged
    if (global.io) {
      global.io.to(`user:${alert.sender}`).emit('call-alert-acknowledged', {
        alertId: alert._id,
        acknowledgedBy: {
          userId: decoded.userId,
          name: receiver.name
        },
        acknowledgedAt: new Date().toISOString(),
        allAcknowledged: alert.receivers.every(r => r.acknowledged)
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Alert acknowledged successfully',
      data: {
        alertId: alert._id,
        acknowledged: true,
        acknowledgedAt: receiver.acknowledgedAt
      }
    });

  } catch (error) {
    console.error('[CallAlert] Error acknowledging alert:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to acknowledge alert', error: error.message },
      { status: 500 }
    );
  }
}
