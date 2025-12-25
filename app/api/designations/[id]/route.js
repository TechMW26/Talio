import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
// GET - Get single designation
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Designation'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Designation } = models

    const designation = await Designation.findById(params.id)

    if (!designation) {
      return NextResponse.json(
        { success: false, message: 'Designation not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: designation,
    })
  } catch (error) {
    console.error('Get designation error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch designation' },
      { status: 500 }
    )
  }
}

// PUT - Update designation
export async function PUT(request, { params }) {
  try {
    const data = await request.json()

    // Prevent department updates (no longer used)
    if ('department' in data) delete data.department

    // Normalize level input
    if ('level' in data) {
      const levelMap = { entry: 1, junior: 2, mid: 3, senior: 4, lead: 5, manager: 6, director: 7, executive: 8 }
      if (typeof data.level === 'string') {
        const lower = data.level.toLowerCase()
        data.level = levelMap[lower] || parseInt(data.level, 10) || 1
      } else if (typeof data.level !== 'number') {
        data.level = 1
      }
    }

    const update = {}
    if (data.title !== undefined) update.title = data.title
    if (data.level !== undefined) update.level = data.level
    if (data.levelName !== undefined) update.levelName = data.levelName
    if (data.description !== undefined) update.description = data.description
    if (data.isActive !== undefined) update.isActive = data.isActive

    const designation = await Designation.findByIdAndUpdate(
      params.id,
      update,
      { new: true, runValidators: true }
    )

    if (!designation) {
      return NextResponse.json(
        { success: false, message: 'Designation not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Designation updated successfully',
      data: designation,
    })
  } catch (error) {
    console.error('Update designation error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update designation' },
      { status: 500 }
    )
  }
}

// DELETE - Delete designation
export async function DELETE(request, { params }) {
  try {
    const designation = await Designation.findByIdAndDelete(params.id)

    if (!designation) {
      return NextResponse.json(
        { success: false, message: 'Designation not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Designation deleted successfully',
    })
  } catch (error) {
    console.error('Delete designation error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete designation' },
      { status: 500 }
    )
  }
}

