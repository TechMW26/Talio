import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { emitAssetUpdate } from '@/lib/realtimeEvents'
import mongoose from 'mongoose'
import { normalizeAssetInput, normalizeAssetStatus } from '@/utils/assetData'

// Helper to validate MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}

// GET - List assets
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Asset'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Asset } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status')

    const query = {}

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
    const auth = await getAuthAndModels(request, ['Asset', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Asset, Employee } = models

    // Check if user has permission
    if (!['admin', 'hr', 'super_admin'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Forbidden: Only Admin and HR can add assets' }, { status: 403 })
    }

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

    if (data.assignedTo) data.assignedDate = new Date()

    const asset = await Asset.create(data)

    const populatedAsset = await Asset.findById(asset._id)
      .populate('assignedTo', 'firstName lastName employeeCode')

    // Emit real-time event
    emitAssetUpdate(populatedAsset, [], { action: 'create', broadcast: true })

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

