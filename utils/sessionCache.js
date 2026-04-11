/**
 * Client-Side Session Cache
 * 
 * Caches auth validation and user data to avoid repeated API calls
 * on slow networks. Uses in-memory cache with TTL.
 */

// In-memory session cache
const SESSION_CACHE = {
  authValidation: null,
  authValidatedAt: 0,
  profileStatus: null,
  profileStatusFetchedAt: 0,
  employeeData: null,
  employeeDataFetchedAt: 0,
}

// Cache TTLs (in milliseconds)
const AUTH_CACHE_TTL = 5 * 60 * 1000 // 5 minutes - auth status
const PROFILE_CACHE_TTL = 10 * 60 * 1000 // 10 minutes - profile completion
const EMPLOYEE_CACHE_TTL = 30 * 60 * 1000 // 30 minutes - employee data

/**
 * Check if cached auth is still valid
 */
export function getCachedAuthValidation() {
  const now = Date.now()
  if (SESSION_CACHE.authValidation && (now - SESSION_CACHE.authValidatedAt) < AUTH_CACHE_TTL) {
    return SESSION_CACHE.authValidation
  }
  return null
}

/**
 * Cache auth validation result
 */
export function setCachedAuthValidation(result) {
  SESSION_CACHE.authValidation = result
  SESSION_CACHE.authValidatedAt = Date.now()
}

/**
 * Clear auth cache (on logout or token change)
 */
export function clearAuthCache() {
  SESSION_CACHE.authValidation = null
  SESSION_CACHE.authValidatedAt = 0
}

/**
 * Get cached profile completion status
 */
export function getCachedProfileStatus() {
  const now = Date.now()
  if (SESSION_CACHE.profileStatus && (now - SESSION_CACHE.profileStatusFetchedAt) < PROFILE_CACHE_TTL) {
    return SESSION_CACHE.profileStatus
  }
  return null
}

/**
 * Cache profile completion status
 */
export function setCachedProfileStatus(status) {
  SESSION_CACHE.profileStatus = status
  SESSION_CACHE.profileStatusFetchedAt = Date.now()
}

/**
 * Get cached employee data
 */
export function getCachedEmployeeData(employeeId) {
  const now = Date.now()
  if (
    SESSION_CACHE.employeeData && 
    SESSION_CACHE.employeeData._id === employeeId &&
    (now - SESSION_CACHE.employeeDataFetchedAt) < EMPLOYEE_CACHE_TTL
  ) {
    return SESSION_CACHE.employeeData
  }
  return null
}

/**
 * Cache employee data
 */
export function setCachedEmployeeData(data) {
  SESSION_CACHE.employeeData = data
  SESSION_CACHE.employeeDataFetchedAt = Date.now()
}

/**
 * Clear all session caches
 */
export function clearAllSessionCaches() {
  SESSION_CACHE.authValidation = null
  SESSION_CACHE.authValidatedAt = 0
  SESSION_CACHE.profileStatus = null
  SESSION_CACHE.profileStatusFetchedAt = 0
  SESSION_CACHE.employeeData = null
  SESSION_CACHE.employeeDataFetchedAt = 0
}

/**
 * Fetch with retry and timeout for slow networks
 */
export async function fetchWithRetry(url, options = {}, maxRetries = 2, timeout = 10000) {
  let lastError

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      return response
    } catch (error) {
      lastError = error

      // Don't retry on abort (user cancelled) or non-retryable errors
      if (error.name === 'AbortError' || attempt === maxRetries) {
        throw error
      }

      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500))
    }
  }

  throw lastError
}

/**
 * Optimistic auth check using localStorage
 * Returns cached token/user without hitting the network
 */
export function getOptimisticAuth() {
  if (typeof window === 'undefined') return null

  const token = localStorage.getItem('token')
  const userData = localStorage.getItem('user')

  if (!token || !userData) return null

  try {
    const user = JSON.parse(userData)
    return { token, user }
  } catch {
    return null
  }
}

function syncStoredUserFromValidation(validatedUser) {
  if (typeof window === 'undefined' || !validatedUser) {
    return { changed: false, user: null }
  }

  const optimisticAuth = getOptimisticAuth()
  if (!optimisticAuth?.user) {
    return { changed: false, user: null }
  }

  const storedUser = optimisticAuth.user
  const storedPermissions = storedUser.permissions || storedUser.permissionsCache || null
  const nextPermissions = validatedUser.permissions || validatedUser.permissionsCache || null

  const previousSnapshot = JSON.stringify({
    role: storedUser.role || null,
    roleId: storedUser.roleId || null,
    permissions: storedPermissions,
    isDepartmentHead: storedUser.isDepartmentHead === true,
    headOfDepartments: storedUser.headOfDepartments || [],
    forcePasswordChange: storedUser.forcePasswordChange === true,
  })

  const nextUser = {
    ...storedUser,
    ...validatedUser,
    role: validatedUser.role ?? storedUser.role,
    roleId: validatedUser.roleId ?? storedUser.roleId ?? null,
    permissions: nextPermissions,
    permissionsCache: nextPermissions,
    isDepartmentHead: validatedUser.isDepartmentHead ?? storedUser.isDepartmentHead ?? false,
    headOfDepartments: validatedUser.headOfDepartments ?? storedUser.headOfDepartments ?? [],
    forcePasswordChange: validatedUser.forcePasswordChange ?? storedUser.forcePasswordChange ?? false,
  }

  const nextSnapshot = JSON.stringify({
    role: nextUser.role || null,
    roleId: nextUser.roleId || null,
    permissions: nextPermissions,
    isDepartmentHead: nextUser.isDepartmentHead === true,
    headOfDepartments: nextUser.headOfDepartments || [],
    forcePasswordChange: nextUser.forcePasswordChange === true,
  })

  const changed = previousSnapshot !== nextSnapshot
  if (changed) {
    localStorage.setItem('user', JSON.stringify(nextUser))
  }

  return { changed, user: nextUser }
}

/**
 * Validate auth in background and handle invalid sessions
 */
export async function validateAuthBackground(token, onInvalid, options = {}) {
  const { force = false } = options

  // Check cache first
  const cachedResult = force ? null : getCachedAuthValidation()
  if (cachedResult) {
    const syncedUser = syncStoredUserFromValidation(cachedResult.user)
    if (!cachedResult.valid) {
      onInvalid?.(cachedResult.message)
    }
    return { ...cachedResult, userChanged: syncedUser.changed }
  }

  try {
    const queryParams = new URLSearchParams()
    if (force) {
      queryParams.set('ts', Date.now().toString())
      queryParams.set('skipWarmCache', '1')
    }
    const validateUrl = queryParams.size > 0 ? `/api/auth/validate?${queryParams.toString()}` : '/api/auth/validate'

    const response = await fetchWithRetry(validateUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
      cache: 'no-store',
    }, 1, 8000) // 1 retry, 8 second timeout

    const data = await response.json()
    const syncedUser = syncStoredUserFromValidation(data.user)

    // Cache the result
    setCachedAuthValidation(data)

    if (!response.ok || !data.valid) {
      onInvalid?.(data.message || 'Session expired')
      return { valid: false, message: data.message, userChanged: syncedUser.changed }
    }

    return { ...data, userChanged: syncedUser.changed }
  } catch (error) {
    // On network error, trust localStorage (offline-first)
    console.warn('[SessionCache] Auth validation failed, using cached data:', error.message)
    return { valid: true, offline: true, userChanged: false }
  }
}

export default {
  getCachedAuthValidation,
  setCachedAuthValidation,
  clearAuthCache,
  getCachedProfileStatus,
  setCachedProfileStatus,
  getCachedEmployeeData,
  setCachedEmployeeData,
  clearAllSessionCaches,
  fetchWithRetry,
  getOptimisticAuth,
  validateAuthBackground,
}
