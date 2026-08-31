import { jwtVerify } from 'jose'
import { getTenantModel, getTenantModels } from './tenantModels'
import { buildCacheKey, getCache, setCache } from './cache'
import { getApiFeatureRule } from './planFeatures'
import { checkTenantFeatureAccess } from './companyFeatures.server'

// ============================================================================
// PERFORMANCE: Cached JWT secret + in-process token cache
// Eliminates repeated TextEncoder allocation and redundant jwtVerify calls
// ============================================================================
let _cachedJwtSecret = null
function getJwtSecret() {
  if (!_cachedJwtSecret) {
    _cachedJwtSecret = new TextEncoder().encode(process.env.JWT_SECRET)
  }
  return _cachedJwtSecret
}

// In-process token verification cache (mirrors middleware.js pattern)
// Prevents double-verification when middleware already verified the same token
const AUTH_TOKEN_CACHE = globalThis.__authTokenCache || new Map()
const AUTH_TOKEN_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const AUTH_TOKEN_CACHE_MAX = 500
if (!globalThis.__authTokenCache) {
  globalThis.__authTokenCache = AUTH_TOKEN_CACHE
}

function getCachedTokenPayload(token) {
  const entry = AUTH_TOKEN_CACHE.get(token)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    AUTH_TOKEN_CACHE.delete(token)
    return null
  }
  return entry.payload
}

function setCachedTokenPayload(token, payload) {
  if (AUTH_TOKEN_CACHE.size >= AUTH_TOKEN_CACHE_MAX) {
    const firstKey = AUTH_TOKEN_CACHE.keys().next().value
    AUTH_TOKEN_CACHE.delete(firstKey)
  }
  AUTH_TOKEN_CACHE.set(token, {
    payload,
    expiresAt: Date.now() + AUTH_TOKEN_CACHE_TTL
  })
}

/**
 * Verify JWT token from string
 * Uses in-process cache to avoid redundant cryptographic verification
 * @param {string} token - JWT token string
 * @returns {Object|null} - Decoded payload or null
 */
export async function verifyToken(token) {
  try {
    if (!token) {
      return null
    }

    // Check in-process cache first (avoids redundant jwtVerify)
    const cached = getCachedTokenPayload(token)
    if (cached) return cached

    const { payload } = await jwtVerify(token, getJwtSecret())

    // Cache the verified payload
    setCachedTokenPayload(token, payload)

    return payload
  } catch (error) {
    if (error?.code === 'ERR_JWT_EXPIRED') {
      console.warn('[AUTH] Expired token rejected')
    } else {
      console.error('Token verification error:', error)
    }
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

    // PERFORMANCE: Try to use pre-verified payload from middleware headers
    // This avoids a redundant jwtVerify call since middleware already verified the token
    let payload = null
    const verifiedUserId = request.headers.get('x-verified-user-id')
    const verifiedDatabase = request.headers.get('x-verified-database')
    if (verifiedUserId && verifiedDatabase) {
      // Middleware already verified this token - reconstruct payload from headers
      payload = {
        userId: verifiedUserId,
        databaseName: verifiedDatabase,
        email: request.headers.get('x-verified-email'),
        companySlug: request.headers.get('x-verified-company-slug'),
        companyName: request.headers.get('x-verified-company-name'),
        role: request.headers.get('x-verified-role'),
      }
    } else {
      // Fallback: verify token directly (e.g., non-middleware paths or direct calls)
      payload = await verifyToken(token)
    }

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

    const authCacheKey = buildCacheKey({
      tenantId: tenantInfo.databaseName,
      role: 'any',
      userId: payload.userId,
      namespace: 'auth:user'
    })

    const cachedUser = await getCache(authCacheKey)
    if (cachedUser) {
      if (!cachedUser.isActive) {
        return {
          success: false,
          message: 'User account is deactivated'
        }
      }

      return {
        success: true,
        user: {
          ...payload,
          token,
          _id: cachedUser._id,
          id: cachedUser._id,
          email: cachedUser.email,
          role: cachedUser.role,
          roleId: cachedUser.roleId || null,
          employeeId: cachedUser.employeeId,
        },
        tenant: tenantInfo,
      }
    }

    // Use tenant-specific User model - only load what we need for auth
    const UserModel = await getTenantModel(tenantInfo.databaseName, 'User');

    // Fetch user from the tenant's database - minimal projection for auth
    const user = await UserModel.findById(payload.userId)
      .select('_id email role employeeId isActive roleId permissionsCache cacheUpdatedAt')
      .lean()

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

    await setCache(authCacheKey, {
      _id: user._id.toString(),
      email: user.email,
      role: user.role,
      roleId: user.roleId ? user.roleId.toString() : null,
      employeeId: user.employeeId,
      isActive: user.isActive
    }, 5 * 60)

    return {
      success: true,
      user: {
        ...payload,
        token, // include raw token for downstream API calls
        _id: user._id,
        id: user._id,
        email: user.email,
        role: user.role,
        roleId: user.roleId ? user.roleId.toString() : null,
        employeeId: user.employeeId,
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

  const apiFeatureRule = getApiFeatureRule(new URL(request.url).pathname)
  if (apiFeatureRule) {
    const access = await checkTenantFeatureAccess(auth, apiFeatureRule)
    if (!access.success) {
      return {
        success: false,
        status: access.status || 403,
        code: access.code || 'FEATURE_DISABLED',
        message: access.message,
        missingFeatures: access.missing || [],
      }
    }
    auth.companyFeatures = access.features
  }

  // If no models requested, just return auth info
  if (modelNames.length === 0) {
    return auth;
  }

  try {
    // Get models from tenant database - NEVER fall back to default DB
    const models = await getTenantModels(auth.tenant.databaseName, modelNames);

    // Verify all requested models were loaded
    for (const name of modelNames) {
      if (!models[name]) {
        console.error(`[getAuthAndModels] Model ${name} not found in loaded models. Available:`, Object.keys(models));
      }
    }

    return {
      ...auth,
      models,
    };
  } catch (error) {
    console.error('[getAuthAndModels] Error loading models:', error.message, error.stack);
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

/**
 * Synchronous permission check.
 * Reads from user.permissions (the resolved cache attached by requirePermission)
 * or user.permissionsCache (raw DB field).
 *
 * Use this inside a handler when you already have the user object and need to
 * branch on a secondary permission without a second DB round-trip.
 *
 * @param {Object} user - User object with permissions or permissionsCache
 * @param {string} pageSlug - A key from PAGE_SLUGS
 * @param {string} action - A key from ACTIONS
 * @returns {boolean}
 */
export function hasPermission(user, pageSlug, action) {
  const perms = user?.permissions || user?.permissionsCache
  if (!perms) return false
  const key = `${action}_${pageSlug}`
  return perms[pageSlug]?.[key] === true
}
