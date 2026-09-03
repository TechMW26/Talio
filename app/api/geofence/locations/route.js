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
// GET - List all geofence locations
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['GeofenceLocation', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { GeofenceLocation, User } = models

    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('activeOnly') === 'true'
    const company = searchParams.get('company')

    const query = activeOnly ? { isActive: true } : {}
    if (company) {
      if (!mongoose.Types.ObjectId.isValid(company)) {
        return NextResponse.json({ success: false, message: 'Invalid company ID' }, { status: 400 })
      }
      query.$or = [
        { company },
        { scope: 'organisation' },
        { company: null },
        { company: { $exists: false }, scope: { $exists: false } },
      ]
    }

    const locations = await GeofenceLocation.find(query)
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName')
      .populate('allowedDepartments', 'name')
      .sort({ isPrimary: -1, createdAt: -1 })

    return NextResponse.json({
      success: true,
      data: locations,
      count: locations.length
    })

  } catch (error) {
    console.error('Get geofence locations error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch geofence locations' },
      { status: 500 }
    )
  }
}

// POST - Create new geofence location
export async function POST(request) {
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
        { success: false, message: 'Only admin and HR can create geofence locations' },
        { status: 403 }
      )
    }

    const userRecord = await User.findById(user._id || user.userId).populate('employeeId')
    const employeeId = userRecord?.employeeId?._id

    const body = sanitizeLocation(await request.json())

    // Validate required fields
    if (!body.name || !isCoordinate(body.center?.latitude, -90, 90) || !isCoordinate(body.center?.longitude, -180, 180) || !Number.isFinite(body.radius) || body.radius < 10 || body.radius > 100000) {
      return NextResponse.json(
        { success: false, message: 'Name, center coordinates, and radius are required' },
        { status: 400 }
      )
    }

    // If this is set as primary, check if there's already a primary location
    if (body.isPrimary) {
      const existingPrimary = await GeofenceLocation.findOne({ isPrimary: true, company: body.company })
      if (existingPrimary) {
        // Update existing primary to non-primary
        existingPrimary.isPrimary = false
        await existingPrimary.save()
      }
    }

    const location = await GeofenceLocation.create({
      ...body,
      createdBy: employeeId,
      updatedBy: employeeId,
    })

    await location.populate('createdBy', 'firstName lastName')
    await location.populate('allowedDepartments', 'name')

    return NextResponse.json({
      success: true,
      message: 'Geofence location created successfully',
      data: location
    })

  } catch (error) {
    console.error('Create geofence location error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create geofence location' },
      { status: 500 }
    )
  }
}

