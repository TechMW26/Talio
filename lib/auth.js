import { jwtVerify } from 'jose'
import { getTenantModel, getTenantModels } from './tenantModels'

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
 * SECURITY: This function REQUIRES tenant context - no fallback to default DB
 * 
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

    // SECURITY: Require tenant context - no fallback to default database
    if (!payload.databaseName) {
      console.error('[AUTH SECURITY] Token missing databaseName - rejecting request for:', payload.email);
      return {
        success: false,
        message: 'Invalid session - please log in again'
      }
    }

    // Extract tenant info from JWT
    const tenantInfo = {
      databaseName: payload.databaseName,
      companySlug: payload.companySlug,
      companyName: payload.companyName,
    };

    // Use tenant-specific User model - NEVER fall back to default DB
    const UserModel = await getTenantModel(tenantInfo.databaseName, 'User');

    // Fetch user from the tenant's database
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
 * Get tenant-aware models for API routes
 * SECURITY: This is the PRIMARY function API routes should use for multi-tenant database access
 * This function REQUIRES tenant context - it will reject requests without valid tenant info
 * 
 * @param {Request} request - Next.js request object
 * @param {string[]} modelNames - Array of model names to load (e.g., ['User', 'Employee', 'Attendance'])
 * @returns {Promise<{success: boolean, user?: Object, tenant?: Object, models?: Object, message?: string}>}
 * 
 * @example
 * const { success, user, models, message } = await getAuthAndModels(request, ['Employee', 'Attendance']);
 * if (!success) return NextResponse.json({ message }, { status: 401 });
 * const employees = await models.Employee.find({});
 */
export async function getAuthAndModels(request, modelNames = []) {
  // First verify the token and get user/tenant info
  const auth = await verifyTokenFromRequest(request);
  
  if (!auth.success) {
    return auth;
  }

  // SECURITY: Double-check tenant context exists
  if (!auth.tenant?.databaseName) {
    console.error('[AUTH SECURITY] getAuthAndModels called without tenant context');
    return {
      success: false,
      message: 'Invalid session - please log in again'
    };
  }
  
  // If no models requested, just return auth info
  if (modelNames.length === 0) {
    return auth;
  }
  
  try {
    // Get models from tenant database - NEVER fall back to default DB
    const models = await getTenantModels(auth.tenant.databaseName, modelNames);
    
    return {
      ...auth,
      models,
    };
  } catch (error) {
    console.error('[getAuthAndModels] Error loading models:', error);
    return {
      success: false,
      message: 'Failed to load database models'
    };
  }
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
