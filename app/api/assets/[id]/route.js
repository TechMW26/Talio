import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import jwt from 'jsonwebtoken'

// PUT - Update asset
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Asset'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Asset } = models

    // Auth check
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      if (!['admin', 'hr'].includes(decoded.role)) {
        return NextResponse.json({ success: false, message: 'Forbidden: Only Admin and HR can update assets' }, { status: 403 })
      }
    } catch (err) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const data = await request.json()

    const asset = await Asset.findByIdAndUpdate(
      params.id,
      data,
      { new: true, runValidators: true }
    ).populate('assignedTo', 'firstName lastName employeeCode')

    if (!asset) {
      return NextResponse.json(
        { success: false, message: 'Asset not found' },
        { status: 404 }
      )
    }

    // Emit Socket.IO event for asset assignments/updates
    try {
      const io = global.io
      if (io && data.assignedTo) {
        const Employee = require('@/models/Employee').default
        const employeeDoc = await Employee.findById(data.assignedTo).select('userId')
        const employeeUserId = employeeDoc?.userId

        if (employeeUserId) {
          const action = data.status === 'returned' ? 'returned' : 'assigned'
          const icon = action === 'returned' ? '↩️' : '🔧'

          // Socket.IO event
          io.to(`user:${employeeUserId}`).emit('asset-update', {
            asset,
            action,
            message: `Asset "${asset.name}" (${asset.assetCode}) has been ${action}`,
            timestamp: new Date()
          })
          console.log(`✅ [Socket.IO] Asset update sent to user:${employeeUserId}`)

          // FCM push notification
          try {
            const { sendPushToUser } = require('@/lib/pushNotification')
            await sendPushToUser(
              employeeUserId,
              {
                title: `${icon} Asset ${action === 'assigned' ? 'Assigned' : 'Returned'}`,
                body: `Asset "${asset.name}" (${asset.assetCode}) has been ${action}`,
              },
              {
                clickAction: '/dashboard/assets',
                eventType: 'asset_update',
                data: {
                  assetId: asset._id.toString(),
                  action,
                  type: 'asset_update'
                }
              }
            )
            console.log(`📲 [FCM] Asset notification sent to user:${employeeUserId}`)
          } catch (fcmError) {
            console.error('Failed to send asset FCM notification:', fcmError)
          }
        }
      }
    } catch (socketError) {
      console.error('Failed to send asset socket notification:', socketError)
    }

    return NextResponse.json({
      success: true,
      message: 'Asset updated successfully',
      data: asset,
    })
  } catch (error) {
    console.error('Update asset error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update asset' },
      { status: 500 }
    )
  }
}

// DELETE - Delete asset
export async function DELETE(request, { params }) {
  try {
    // Auth check
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      if (!['admin', 'hr'].includes(decoded.role)) {
        return NextResponse.json({ success: false, message: 'Forbidden: Only Admin and HR can delete assets' }, { status: 403 })
      }
    } catch (err) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const asset = await Asset.findByIdAndDelete(params.id)

    if (!asset) {
      return NextResponse.json(
        { success: false, message: 'Asset not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Asset deleted successfully',
    })
  } catch (error) {
    console.error('Delete asset error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete asset' },
      { status: 500 }
    )
  }
}

