import { NextResponse } from 'next/server'
import { verifyTokenFromRequest } from '@/lib/auth'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { resolveUserPermissions } from '@/lib/permissions'

export async function GET(request) {
  try {
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
    const auth = await verifyTokenFromRequest(request)
    if (!auth.success) return NextResponse.json({ valid: false, message: auth.message }, { status: 401 })
    const payload = auth.user

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

    const database = await getFirestoreTenantDatabase(payload.databaseName)
    const user = await database.get('users', String(payload.userId))

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
      return NextResponse.json({ valid: false, message: 'Unable to verify account permissions' }, { status: 503 })
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
