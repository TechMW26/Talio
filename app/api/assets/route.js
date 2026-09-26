import { NextResponse, after } from 'next/server'
import { emitAssetUpdate } from '@/lib/realtimeEvents'
import { requirePermission, checkPermission } from '@/lib/permissions'
import { notifyAssetAssignment, assetNotificationRecipients } from '@/lib/assetNotifications.server'
import mongoose from 'mongoose'
import { normalizeAssetInput, normalizeAssetStatus } from '@/utils/assetData'
import { assetHistoryEvent, prepareAssetTransition } from '@/lib/assetHistory'

// Helper to validate MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}

// GET - List assets
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await requirePermission('assets', 'view')(request, ['Asset'])
    if (auth.denied) return auth.denied
    const { user, models } = auth
    const { Asset } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status')

    const query = {}
    const managesInventory = ['create', 'edit', 'manage', 'assign'].some(action => checkPermission(user.permissions, 'assets', action))
    if (!managesInventory) {
      const ownId = String(user.employeeId?._id || user.employeeId || '')
      if (!isValidObjectId(ownId)) return NextResponse.json({ success: true, data: [] })
      if (employeeId && employeeId !== ownId) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })
      query.assignedTo = ownId
    }

    if (employeeId) {
      if (!isValidObjectId(employeeId)) {
        return NextResponse.json(
          { success: false, message: 'Invalid employee ID' },
          { status: 400 }
        )
      }
      query.assignedTo = employeeId
    }

    if (status) {
      const normalizedStatus = normalizeAssetStatus(status)
      query.status = normalizedStatus === 'under-maintenance'
        ? { $in: ['under-maintenance', 'maintenance'] }
        : normalizedStatus
    }

    const assets = await Asset.find(query)
      .select(managesInventory ? '' : '-history')
      .populate('assignedTo', 'firstName lastName employeeCode')
      .sort({ createdAt: -1 })

    return NextResponse.json({
      success: true,
      data: assets,
    })
  } catch (error) {
    console.error('Get assets error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch assets' },
      { status: 500 }
    )
  }
}

// POST - Create asset
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await requirePermission('assets', 'create')(request, ['Asset', 'Employee', 'Department', 'Team', 'Notification'])
    if (auth.denied) return auth.denied
    const { user, models } = auth
    const { Asset, Employee } = models


    const input = await request.json()
    const { data, errors } = normalizeAssetInput(input)

    if (errors.length > 0) {
      return NextResponse.json(
        { success: false, message: errors[0], errors },
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

    prepareAssetTransition(null, data)
    const historyData = { ...data }
    if (data.assignedTo) historyData.assignedTo = await Employee.findById(data.assignedTo).select('firstName lastName employeeCode').lean()
    data.history = [assetHistoryEvent(null, historyData, user, 'created')]

    const asset = await Asset.create(data)

    const populatedAsset = await Asset.findById(asset._id)
      .populate('assignedTo', 'firstName lastName employeeCode')

    after(() => notifyAssetAssignment({ models, asset: populatedAsset }).catch(error => console.error('[Asset] Notification failed:', error)))

    // Emit real-time event
    const recipients = await assetNotificationRecipients(models, populatedAsset)
    if (recipients.length) emitAssetUpdate(populatedAsset, recipients.map(user => user.id), { action: 'create', broadcast: false })

    return NextResponse.json({
      success: true,
      message: 'Asset created successfully',
      data: populatedAsset,
    }, { status: 201 })
  } catch (error) {
    console.error('Create asset error:', error)
    if (error?.code === 11000) {
      const duplicateField = Object.keys(error.keyPattern || {})[0] || 'asset code'
      return NextResponse.json(
        { success: false, message: `An asset with this ${duplicateField} already exists` },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create asset' },
      { status: 500 }
    )
  }
}

