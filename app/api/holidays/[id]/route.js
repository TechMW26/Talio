import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'
// GET - Get single holiday
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Holiday'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Holiday } = models

    const holiday = await Holiday.findById(params.id)

    if (!holiday) {
      return NextResponse.json(
        { success: false, message: 'Holiday not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: holiday,
    })
  } catch (error) {
    console.error('Get holiday error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch holiday' },
      { status: 500 }
    )
  }
}

// PUT - Update holiday
export async function PUT(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Holiday'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models, tenant } = auth
    const { Holiday } = models

    const data = await request.json()

    const holiday = await Holiday.findByIdAndUpdate(
      params.id,
      data,
      { new: true, runValidators: true }
    )

    if (!holiday) {
      return NextResponse.json(
        { success: false, message: 'Holiday not found' },
        { status: 404 }
      )
    }

    // Invalidate holiday caches
    try {
      await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'holidays' }))
    } catch (cacheErr) {
      console.error('Failed to clear holiday cache:', cacheErr)
    }

    return NextResponse.json({
      success: true,
      message: 'Holiday updated successfully',
      data: holiday,
    })
  } catch (error) {
    console.error('Update holiday error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update holiday' },
      { status: 500 }
    )
  }
}

// DELETE - Delete holiday
export async function DELETE(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Holiday'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models, tenant } = auth
    const { Holiday } = models

    const holiday = await Holiday.findByIdAndDelete(params.id)

    if (!holiday) {
      return NextResponse.json(
        { success: false, message: 'Holiday not found' },
        { status: 404 }
      )
    }

    // Invalidate holiday caches
    try {
      await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'holidays' }))
    } catch (cacheErr) {
      console.error('Failed to clear holiday cache:', cacheErr)
    }

    return NextResponse.json({
      success: true,
      message: 'Holiday deleted successfully',
    })
  } catch (error) {
    console.error('Delete holiday error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete holiday' },
      { status: 500 }
    )
  }
}

