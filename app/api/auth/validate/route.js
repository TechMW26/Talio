import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { getTenantModel } from '@/lib/tenantModels'
import { warmDashboardCaches } from '@/lib/cacheWarming'
import { resolveUserPermissions } from '@/lib/permissions'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const skipWarmCache = searchParams.get('skipWarmCache') === '1'

    // Get token from Authorization header
    const authHeader = request.headers.get('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { valid: false, message: 'No token provided' },
        { status: 401 }
      )
    }

    const token = authHeader.split(' ')[1]

    // Verify the token
    const { payload } = await jwtVerify(token, JWT_SECRET)

    if (!payload || !payload.userId) {
      return NextResponse.json(
        { valid: false, message: 'Invalid token payload' },
        { status: 401 }
      )
    }

    // SECURITY: Require tenant context from JWT
    if (!payload.databaseName) {
      return NextResponse.json(
        { valid: false, message: 'Invalid session - please log in again' },
        { status: 401 }
      )
    }

    // Get tenant-specific User model
    const User = await getTenantModel(payload.databaseName, 'User')

    // Check if user still exists and is active
    const user = await User.findById(payload.userId)
      .select('isActive email forcePasswordChange employeeId role roleId permissionsCache cacheUpdatedAt isDepartmentHead headOfDepartments')
      .lean()

    if (!user) {
      return NextResponse.json(
        { valid: false, message: 'User not found' },
        { status: 401 }
      )
    }

    if (!user.isActive) {
      return NextResponse.json(
        { valid: false, message: 'Account deactivated' },
        { status: 401 }
      )
    }

    let permissions = null
    try {
      permissions = await resolveUserPermissions(user, payload.databaseName)
    } catch (permissionError) {
      console.error('[Auth Validate] Failed to resolve permissions:', permissionError.message)
    }

    // Create response
    const response = NextResponse.json({
      valid: true,
      userId: payload.userId,
      forcePasswordChange: user.forcePasswordChange === true,
      user: {
        email: user.email,
        role: user.role,
        roleId: user.roleId?.toString() || null,
        permissions: permissions || null,
        permissionsCache: permissions || null,
        isDepartmentHead: user.isDepartmentHead === true,
        headOfDepartments: Array.isArray(user.headOfDepartments)
          ? user.headOfDepartments.map((departmentId) => departmentId?.toString()).filter(Boolean)
          : [],
        forcePasswordChange: user.forcePasswordChange === true,
      },
    })

    // Ensure cookie is set from server side (fixes loop when client cookie not set properly)
    // Check if cookie exists in request
    const existingCookie = request.cookies.get('token')?.value
    if (!existingCookie && token) {
      response.cookies.set('token', token, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 // 7 days
      })
    }

    // 🔥 BLOCKING cache warming - populates Redis for dashboard APIs
    // Awaits warming BEFORE returning validate response so the browser's
    // dashboard API calls (fired after validate returns) all hit warm cache.
    // Net effect: validate takes ~3-5s, but total page load is FASTER
    // because 12+ dashboard APIs return in <500ms instead of 3-10s each.
    if (!skipWarmCache) {
      await warmDashboardCaches({
        token,
        role: user.role || payload.role || 'employee',
        employeeId: user.employeeId?.toString() || '',
        userId: payload.userId,
        blocking: true,
        maxWaitMs: 10000, // Safety timeout - don't block more than 10s
      })
    }

    return response

  } catch (error) {
    console.error('[Auth Validate] Error:', error.message)

    // Token expired or invalid
    if (error.code === 'ERR_JWT_EXPIRED') {
      return NextResponse.json(
        { valid: false, message: 'Token expired' },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { valid: false, message: 'Invalid token' },
      { status: 401 }
    )
  }
}
