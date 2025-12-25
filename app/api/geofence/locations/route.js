import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
// GET - List all geofence locations
export async function GET(request) {
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

    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('activeOnly') === 'true'

    const query = activeOnly ? { isActive: true } : {}

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
        { success: false, message: 'Only admin and HR can create geofence locations' },
        { status: 403 }
      )
    }

    const user = await User.findById(decoded.userId).populate('employeeId')
    const employeeId = user?.employeeId?._id

    const body = await request.json()

    // Validate required fields
    if (!body.name || !body.center?.latitude || !body.center?.longitude || !body.radius) {
      return NextResponse.json(
        { success: false, message: 'Name, center coordinates, and radius are required' },
        { status: 400 }
      )
    }

    // If this is set as primary, check if there's already a primary location
    if (body.isPrimary) {
      const existingPrimary = await GeofenceLocation.findOne({ isPrimary: true })
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

