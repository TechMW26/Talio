import { jwtVerify } from 'jose'
import connectDB from './mongodb'
import User from '@/models/User'
import { getTenantModel } from './tenantModels'

/**
 * Verify JWT token from string
 * @param {string} token - JWT token string
 * @returns {Object|null} - Decoded payload or null
 */
export async function verifyToken(token) {
  try {
    if (!token) {
      return null
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    const { payload } = await jwtVerify(token, secret)

    return payload
  } catch (error) {
    console.error('Token verification error:', error)
    return null
  }
}

/**
 * Verify token from request object and return user data with tenant info
 * @param {Request} request - Next.js request object
 * @returns {Object} - { success: boolean, user?: Object, tenant?: Object, message?: string }
 */
export async function verifyTokenFromRequest(request) {
  try {
    // Extract token from Authorization header or cookies
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value

    if (!token) {
      return {
        success: false,
        message: 'No authentication token provided'
      }
    }

    // Verify token
    const payload = await verifyToken(token)

    if (!payload) {
      return {
        success: false,
        message: 'Invalid or expired token'
      }
    }

    // Extract tenant info from JWT if present
    const tenantInfo = payload.databaseName ? {
      databaseName: payload.databaseName,
      companySlug: payload.companySlug,
      companyName: payload.companyName,
    } : null;

    // Get appropriate User model
    let UserModel;
    if (tenantInfo) {
      // Use tenant-specific model
      UserModel = await getTenantModel(tenantInfo.databaseName, 'User');
    } else {
      // Fall back to default database
      await connectDB();
      UserModel = User;
    }

    // Fetch user from the correct database
    const user = await UserModel.findById(payload.userId).select('-password').populate('employeeId')

    if (!user) {
      return {
        success: false,
        message: 'User not found'
      }
    }

    if (!user.isActive) {
      return {
        success: false,
        message: 'User account is deactivated'
      }
    }

    return {
      success: true,
      user: {
        _id: user._id,
        id: user._id,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId,
        ...payload,
        token, // include raw token for downstream API calls
      },
      // Include tenant info for API routes to use
      tenant: tenantInfo,
    }
  } catch (error) {
    console.error('Request token verification error:', error)
    return {
      success: false,
      message: 'Authentication failed'
    }
  }
}

/**
 * Get tenant database name from request (JWT payload)
 * This is useful for API routes that need to connect to the right database
 * @param {Request} request - Next.js request object
 * @returns {Promise<string|null>} - Database name or null
 */
export async function getTenantDatabaseFromRequest(request) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '') || request.cookies?.get('token')?.value

  if (!token) return null;

  const payload = await verifyToken(token);
  return payload?.databaseName || null;
}

/**
 * Middleware helper to check if user has required role
 * @param {Object} user - User object from verifyTokenFromRequest
 * @param {string[]} allowedRoles - Array of allowed roles
 * @returns {boolean}
 */
export function hasRole(user, allowedRoles) {
  if (!user || !user.role) {
    return false
  }
  return allowedRoles.includes(user.role)
}
