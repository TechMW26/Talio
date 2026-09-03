import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'
import { normalizeAssetInput } from '@/utils/assetData'
import { emitAssetUpdate } from '@/lib/realtimeEvents'

// Helper to validate MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}

// PUT - Update asset
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Asset', 'Employee', 'User', 'Notification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Asset, Employee, User, Notification } = models

    // Role check
    if (!['admin', 'hr', 'super_admin'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Forbidden: Only Admin and HR can update assets' }, { status: 403 })
    }

    const input = await request.json()
    const { data, errors } = normalizeAssetInput(input, { partial: true })
    const { id } = await params

    if (errors.length > 0) {
      return NextResponse.json(
        { success: false, message: errors[0], errors },
        { status: 400 }
      )
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { success: false, message: 'No valid asset fields were provided' },
        { status: 400 }
      )
    }

    if (!isValidObjectId(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid asset ID' },
        { status: 400 }
      )
    }

    if (data.assignedTo && !isValidObjectId(data.assignedTo)) {
      return NextResponse.json(
        { success: false, message: 'Invalid assigned employee ID' },
        { status: 400 }
      )
    }


    if (data.assignedTo && !(await Employee.exists({ _id: data.assignedTo }))) {
      return NextResponse.json(
        { success: false, message: 'Assigned employee was not found' },
        { status: 404 }
      )
    }

    if (data.assignedTo) data.assignedDate = new Date()
    else if (Object.hasOwn(data, 'assignedTo')) data.assignedDate = null

    const asset = await Asset.findByIdAndUpdate(
      id,
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
                },
                models: { User, Notification }
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

    emitAssetUpdate(asset, [], { action: 'update', broadcast: true })

    return NextResponse.json({
      success: true,
      message: 'Asset updated successfully',
      data: asset,
    })
  } catch (error) {
    console.error('Update asset error:', error)
    if (error?.code === 11000) {
      const duplicateField = Object.keys(error.keyPattern || {})[0] || 'asset code'
      return NextResponse.json(
        { success: false, message: `An asset with this ${duplicateField} already exists` },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update asset' },
      { status: 500 }
    )
  }
}

// DELETE - Delete asset
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Asset'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Asset } = models

    // Role check
    if (!['admin', 'hr', 'super_admin'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Forbidden: Only Admin and HR can delete assets' }, { status: 403 })
    }

    const { id } = await params

    if (!isValidObjectId(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid asset ID' },
        { status: 400 }
      )
    }

    const asset = await Asset.findByIdAndDelete(id)

    if (!asset) {
      return NextResponse.json(
        { success: false, message: 'Asset not found' },
        { status: 404 }
      )
    }

    emitAssetUpdate(asset, [], { action: 'delete', broadcast: true })

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

