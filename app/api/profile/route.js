import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
export const dynamic = 'force-dynamic'


// GET - Fetch current user's profile
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { Employee, User } = models

    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName,
      role: user.role,
      userId: user._id || user.userId,
      namespace: 'profile'
    })

    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Fetch user with populated employee data
    const userRecord = await User.findById(user._id || user.userId)
      .populate({
        path: 'employeeId',
        select: 'firstName lastName employeeCode email phone profilePicture bio designation designationLevel designationLevelName department departments reportingManager status dateOfJoining dateOfBirth gender address emergencyContact bloodGroup company aiGeneratedKRIs aiGeneratedKRIsMeta manualKRIs manualKPIs',
        populate: [
          { path: 'designation', select: 'title level levelName' },
          { path: 'department', select: 'name code' },
          { path: 'departments', select: 'name code' },
          { path: 'reportingManager', select: 'firstName lastName employeeCode' },
          { path: 'company', select: 'name logo' }
        ]
      })

    if (!userRecord) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    const response = {
      success: true,
      data: {
        user: {
          _id: userRecord._id,
          email: userRecord.email,
          role: userRecord.role
        },
        employee: userRecord.employeeId
      }
    }

    await setCache(cacheKey, response, 10 * 60)

    return NextResponse.json(response)
  } catch (error) {
    console.error('Get profile error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

