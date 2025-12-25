import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
// GET - Get single geofence location
export async function GET(request, { params }) {
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
    const auth = await getAuthAndModels(request, ['GeofenceLocation', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { GeofenceLocation, User } = models

    // Await params to get the id
    const { id } = await params
    const location = await GeofenceLocation.findById(id)
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName')
      .populate('allowedDepartments', 'name')
      .populate('allowedEmployees', 'firstName lastName employeeCode')

    if (!location) {
      return NextResponse.json(
        { success: false, message: 'Geofence location not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: location
    })

  } catch (error) {
    console.error('Get geofence location error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch geofence location' },
      { status: 500 }
    )
  }
}

// PUT - Update geofence location
export async function PUT(request, { params }) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Check if user is admin or hr
    if (decoded.role !== 'admin' && decoded.role !== 'hr') {
      return NextResponse.json(
        { success: false, message: 'Only admin and HR can update geofence locations' },
        { status: 403 }
      )
    }

    // Await params to get the id
    const { id } = await params

    const user = await User.findById(decoded.userId).populate('employeeId')
    const employeeId = user?.employeeId?._id

    const body = await request.json()

    // If setting as primary, remove primary from others
    if (body.isPrimary) {
      await GeofenceLocation.updateMany(
        { _id: { $ne: id }, isPrimary: true },
        { $set: { isPrimary: false } }
      )
    }

    const location = await GeofenceLocation.findByIdAndUpdate(
      id,
      {
        ...body,
        updatedBy: employeeId,
      },
      { new: true, runValidators: true }
    )
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName')
      .populate('allowedDepartments', 'name')

    if (!location) {
      return NextResponse.json(
        { success: false, message: 'Geofence location not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Geofence location updated successfully',
      data: location
    })

  } catch (error) {
    console.error('Update geofence location error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update geofence location' },
      { status: 500 }
    )
  }
}

// DELETE - Delete geofence location
export async function DELETE(request, { params }) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Check if user is admin or hr
    if (decoded.role !== 'admin' && decoded.role !== 'hr') {
      return NextResponse.json(
        { success: false, message: 'Only admin and HR can delete geofence locations' },
        { status: 403 }
      )
    }

    // Await params to get the id
    const { id } = await params
    const location = await GeofenceLocation.findById(id)

    if (!location) {
      return NextResponse.json(
        { success: false, message: 'Geofence location not found' },
        { status: 404 }
      )
    }

    // Check if this is the primary location
    if (location.isPrimary) {
      return NextResponse.json(
        { success: false, message: 'Cannot delete primary location. Please set another location as primary first.' },
        { status: 400 }
      )
    }

    // Soft delete by setting isActive to false
    location.isActive = false
    await location.save()

    return NextResponse.json({
      success: true,
      message: 'Geofence location deleted successfully'
    })

  } catch (error) {
    console.error('Delete geofence location error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete geofence location' },
      { status: 500 }
    )
  }
}

