/**
 * OneSignal Token Registration API (Legacy FCM endpoint)
 * This endpoint is kept for backward compatibility but now uses OneSignal
 */

import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * POST /api/fcm/register-token
 * Register user with OneSignal (backward compatible endpoint)
 */
export async function POST(request) {
  try {
    // Parse request body
    const { token: oneSignalId, device = 'web' } = await request.json()

    if (!oneSignalId) {
      return NextResponse.json(
        { success: false, message: 'OneSignal ID is required' },
        { status: 400 }
      )
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { User } = models;

    // Find user
    const userRecord = await User.findById(user._id || user.userId);
    if (!userRecord) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      );
    }

    console.log(`[OneSignal] User ${userRecord.email} registered with device: ${device}`);

    return NextResponse.json({
      success: true,
      message: 'Registered with OneSignal successfully',
      device
    })

  } catch (error) {
    console.error('[OneSignal] Registration error:', error)
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/fcm/register-token
 * Remove FCM token for a user
 */
export async function DELETE(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user: authUser, models } = auth;
    const { User } = models;

    // Parse request body
    const { token } = await request.json()

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Token is required' },
        { status: 400 }
      )
    }

    // Find user and remove token
    const userRecord = await User.findById(authUser._id)
    if (!userRecord) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      )
    }

    // Remove token
    userRecord.fcmTokens = userRecord.fcmTokens?.filter(t => t.token !== token) || []
    await userRecord.save()

    console.log(`[FCM] Token removed for user ${userRecord.email}`)

    return NextResponse.json({
      success: true,
      message: 'Token removed successfully'
    })

  } catch (error) {
    console.error('[FCM] Delete error:', error)
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    )
  }
}