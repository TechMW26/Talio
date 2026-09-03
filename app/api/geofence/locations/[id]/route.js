import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'

const isCoordinate = (value, min, max) => Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max
const cleanIds = values => Array.isArray(values) ? values.filter(value => mongoose.Types.ObjectId.isValid(value)) : []

function sanitizeLocation(body) {
  const company = body.company && mongoose.Types.ObjectId.isValid(body.company) ? body.company : null
  return {
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    address: String(body.address || '').trim(),
    center: { latitude: Number(body.center?.latitude), longitude: Number(body.center?.longitude) },
    radius: Number(body.radius),
    isActive: body.isActive !== false,
    isPrimary: body.isPrimary === true,
    strictMode: body.strictMode === true,
    company,
    scope: company ? 'company' : 'organisation',
    allowedDepartments: cleanIds(body.allowedDepartments),
    allowedEmployees: cleanIds(body.allowedEmployees),
    workingHours: body.workingHours,
    breakTimings: Array.isArray(body.breakTimings) ? body.breakTimings : [],
  }
}
// GET - Get single geofence location
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['GeofenceLocation', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { GeofenceLocation, User } = models

    // Await params to get the id
    const { id } = await params
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, message: 'Invalid location ID' }, { status: 400 })
    }
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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['GeofenceLocation', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { GeofenceLocation, User } = models

    // Check if user is admin or hr
    if (user.role !== 'admin' && user.role !== 'hr') {
      return NextResponse.json(
        { success: false, message: 'Only admin and HR can update geofence locations' },
        { status: 403 }
      )
    }

    // Await params to get the id
    const { id } = await params
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, message: 'Invalid location ID' }, { status: 400 })
    }

    const userRecord = await User.findById(user._id || user.userId).populate('employeeId')
    const employeeId = userRecord?.employeeId?._id

    const body = sanitizeLocation(await request.json())
    if (!body.name || !isCoordinate(body.center?.latitude, -90, 90) || !isCoordinate(body.center?.longitude, -180, 180) || !Number.isFinite(body.radius) || body.radius < 10 || body.radius > 100000) {
      return NextResponse.json({ success: false, message: 'Enter a valid name, coordinates, and radius (10-100000m)' }, { status: 400 })
    }

    // If setting as primary, remove primary from others
    if (body.isPrimary) {
      await GeofenceLocation.updateMany(
        { _id: { $ne: id }, isPrimary: true, company: body.company },
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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['GeofenceLocation'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { GeofenceLocation } = models

    // Check if user is admin or hr
    if (user.role !== 'admin' && user.role !== 'hr') {
      return NextResponse.json(
        { success: false, message: 'Only admin and HR can delete geofence locations' },
        { status: 403 }
      )
    }

    // Await params to get the id
    const { id } = await params
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, message: 'Invalid location ID' }, { status: 400 })
    }
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

