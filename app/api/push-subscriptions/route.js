import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'

// POST - Save push subscription
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['PushSubscription'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { PushSubscription } = models

    const { subscription, deviceInfo } = await request.json()

    if (!subscription || !subscription.endpoint) {
      return NextResponse.json(
        { success: false, message: 'Invalid subscription data' },
        { status: 400 }
      )
    }

    // Check if subscription already exists
    const existingSubscription = await PushSubscription.findOne({
      user: decoded.userId,
      endpoint: subscription.endpoint
    })

    if (existingSubscription) {
      // Update existing subscription
      existingSubscription.keys = subscription.keys
      existingSubscription.deviceInfo = deviceInfo
      existingSubscription.lastUsed = new Date()
      await existingSubscription.save()

      return NextResponse.json({
        success: true,
        message: 'Push subscription updated successfully',
        data: existingSubscription
      })
    }

    // Create new subscription
    const newSubscription = new PushSubscription({
      user: decoded.userId,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      deviceInfo: deviceInfo || {},
      createdAt: new Date(),
      lastUsed: new Date()
    })

    await newSubscription.save()

    return NextResponse.json({
      success: true,
      message: 'Push subscription saved successfully',
      data: newSubscription
    })

  } catch (error) {
    console.error('Save push subscription error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to save push subscription' },
      { status: 500 }
    )
  }
}

// GET - Get user's push subscriptions
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const subscriptions = await PushSubscription.find({ user: decoded.userId })
      .sort({ lastUsed: -1 })

    return NextResponse.json({
      success: true,
      data: subscriptions
    })

  } catch (error) {
    console.error('Get push subscriptions error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch push subscriptions' },
      { status: 500 }
    )
  }
}

// DELETE - Remove push subscription
export async function DELETE(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const { endpoint } = await request.json()

    if (!endpoint) {
      return NextResponse.json(
        { success: false, message: 'Endpoint is required' },
        { status: 400 }
      )
    }

    const result = await PushSubscription.findOneAndDelete({
      user: decoded.userId,
      endpoint
    })

    if (!result) {
      return NextResponse.json(
        { success: false, message: 'Subscription not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Push subscription removed successfully'
    })

  } catch (error) {
    console.error('Delete push subscription error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to remove push subscription' },
      { status: 500 }
    )
  }
}

