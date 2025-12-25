import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import jwt from 'jsonwebtoken'

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
      query.assignedTo = employeeId
    }

    if (status) {
      query.status = status
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
    // Auth check
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      if (!['admin', 'hr'].includes(decoded.role)) {
        return NextResponse.json({ success: false, message: 'Forbidden: Only Admin and HR can add assets' }, { status: 403 })
      }
    } catch (err) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const data = await request.json()

    const asset = await Asset.create(data)

    const populatedAsset = await Asset.findById(asset._id)
      .populate('assignedTo', 'firstName lastName employeeCode')

    return NextResponse.json({
      success: true,
      message: 'Asset created successfully',
      data: populatedAsset,
    }, { status: 201 })
  } catch (error) {
    console.error('Create asset error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create asset' },
      { status: 500 }
    )
  }
}

