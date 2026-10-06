/**
 * OneSignal Token Registration API (Legacy FCM endpoint)
 * This endpoint is kept for backward compatibility but now uses OneSignal
 */

import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'

/**
 * POST /api/fcm/register-token
 * Register user with OneSignal (backward compatible endpoint)
 */
export async function POST(request) {
  try {
    // Parse request body
    const { token: oneSignalId, device = 'web' } = await request.json()

    if (typeof oneSignalId !== 'string' || !oneSignalId || oneSignalId.length > 4096 || typeof device !== 'string' || device.length > 80) {
      return NextResponse.json(
        { success: false, message: 'OneSignal ID is required' },
        { status: 400 }
      )
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndDatabase(request);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, database } = auth;

    // Find user
    const userRecord = await database.get('users', user._id || user.userId);
    if (!userRecord) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      );
    }

    await database.mutate('users', String(user._id || user.userId), row => { if (!row || row.isActive === false) throw new Error('User unavailable'); return { ...row, oneSignalDevices: [...(row.oneSignalDevices || []).filter(item => item.id !== oneSignalId), { id: oneSignalId, device, registeredAt: new Date() }].slice(-100) } })

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
    const auth = await getAuthAndDatabase(request);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user: authUser, database } = auth;

    // Parse request body
    const { token } = await request.json()

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Token is required' },
        { status: 400 }
      )
    }

    // Find user and remove token
    const userRecord = await database.get('users', authUser._id)
    if (!userRecord) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      )
    }

    await database.mutate('users', String(authUser._id || authUser.userId), row => { if (!row || row.isActive === false) throw new Error('User unavailable'); return { ...row, fcmTokens: (row.fcmTokens || []).filter(t => t.token !== token) } })

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
