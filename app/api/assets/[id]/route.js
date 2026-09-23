import { NextResponse, after } from 'next/server'
import { requirePermission } from '@/lib/permissions'
import { notifyAssetAssignment, assetNotificationRecipients } from '@/lib/assetNotifications.server'
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
    const auth = await requirePermission('assets', 'edit')(request, ['Asset', 'Employee', 'Department', 'Team', 'Notification'])
    if (auth.denied) return auth.denied
    const { models } = auth
    const { Asset, Employee } = models


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

    const previous = await Asset.findById(id).select('assignedTo').lean()
    if (!previous) return NextResponse.json({ success: false, message: 'Asset not found' }, { status: 404 })
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

    after(() => notifyAssetAssignment({ models, asset, previousAssignee: previous.assignedTo }).catch(error => console.error('[Asset] Notification failed:', error)))

    const recipients = await assetNotificationRecipients(models, asset)
    if (recipients.length) emitAssetUpdate(asset, recipients.map(user => user.id), { action: 'update', broadcast: false })

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
    const auth = await requirePermission('assets', 'delete')(request, ['Asset', 'Employee', 'Department', 'Team'])
    if (auth.denied) return auth.denied
    const { models } = auth
    const { Asset } = models


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

    const recipients = await assetNotificationRecipients(models, asset)
    if (recipients.length) emitAssetUpdate(asset, recipients.map(user => user.id), { action: 'delete', broadcast: false })

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

