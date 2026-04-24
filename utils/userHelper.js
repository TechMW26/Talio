/**
 * User Data Helper Utilities
 * 
 * Provides consistent access to user data from localStorage,
 * handling various data formats for backward compatibility.
 */

/**
 * Get the current user from localStorage
 * @returns {Object|null} User object or null if not found
 */
export function getCurrentUser() {
  if (typeof window === 'undefined') return null
  
  try {
    const userData = localStorage.getItem('user')
    if (!userData) return null
    return JSON.parse(userData)
  } catch (error) {
    console.error('Error parsing user data:', error)
    return null
  }
}

/**
 * Get employee ID from user object, handling multiple formats
 * Handles: { employeeId: "123" }, { employeeId: { _id: "123" } }, { employeeId: { id: "123" } }
 * 
 * @param {Object} user - User object from localStorage
 * @returns {string|null} Employee ID string or null
 */
export function getEmployeeId(user) {
  if (!user) return null
  
  const empId = user.employeeId
  if (!empId) return null
  
  // Handle object format: { _id: "123" } or { id: "123" }
  if (typeof empId === 'object') {
    return empId._id || empId.id || null
  }
  
  // Handle string format
  if (typeof empId === 'string') {
    return empId
  }
  
  return null
}

/**
 * Get user ID from user object, handling multiple formats
 * Handles: { id: "123" }, { _id: "123" }, { userId: "123" }
 * 
 * @param {Object} user - User object from localStorage
 * @returns {string|null} User ID string or null
 */
export function getUserId(user) {
  if (!user) return null
  return user.id || user._id || user.userId || null
}

/**
 * Get full name from user object
 * @param {Object} user - User object
 * @returns {string} Full name or email fallback
 */
export function getFullName(user) {
  if (!user) return 'Unknown'
  
  // Check top-level names first
  if (user.firstName || user.lastName) {
    return [user.firstName, user.lastName].filter(Boolean).join(' ')
  }
  
  // Check if full name is provided
  if (user.fullName) return user.fullName
  
  // Check employeeId object for names
  if (user.employeeId && typeof user.employeeId === 'object') {
    if (user.employeeId.firstName || user.employeeId.lastName) {
      return [user.employeeId.firstName, user.employeeId.lastName].filter(Boolean).join(' ')
    }
    if (user.employeeId.fullName) return user.employeeId.fullName
  }
  
  // Fallback to email
  return user.email || 'Unknown'
}

/**
 * Get user's role
 * @param {Object} user - User object
 * @returns {string} User role or 'employee' as default
 */
export function getUserRole(user) {
  if (!user) return 'employee'
  return user.role || 'employee'
}

/**
 * Check if user has admin-level access
 * @param {Object} user - User object
 * @returns {boolean}
 */
export function isAdmin(user) {
  const adminRoles = ['admin', 'hr']
  return adminRoles.includes(getUserRole(user))
}

/**
 * Check if user has manager-level access
 * @param {Object} user - User object
 * @returns {boolean}
 */
export function isManager(user) {
  const managerRoles = ['admin', 'hr', 'manager', 'department_head']
  return managerRoles.includes(getUserRole(user))
}

/**
 * Get designation display text
 * @param {Object} designation - Designation object or string
 * @returns {string} Formatted designation
 */
export function getDesignationText(designation) {
  if (!designation) return 'N/A'
  
  if (typeof designation === 'string') return designation
  
  const title = designation.title || ''
  const levelName = designation.levelName || ''
  
  if (levelName && title) {
    return `(${levelName}) - ${title}`
  }
  
  return title || 'N/A'
}

/**
 * Get department name
 * @param {Object} department - Department object or string
 * @returns {string} Department name
 */
export function getDepartmentName(department) {
  if (!department) return 'N/A'
  
  if (typeof department === 'string') return department
  
  return department.name || 'N/A'
}

/**
 * Get the auth token from localStorage
 * @returns {string|null}
 */
export function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token')
}

/**
 * Check if user is authenticated (has token and user data)
 * @returns {boolean}
 */
export function isAuthenticated() {
  return !!getToken() && !!getCurrentUser()
}

// Flag to prevent multiple redirects
let isRedirecting = false

/**
 * Reset the redirect flag (for testing or after navigation)
 */
export function resetRedirectFlag() {
  isRedirecting = false
}

/**
 * Handle session expiration - clear auth and redirect to login
 */
export function handleSessionExpired() {
  // Prevent multiple redirects
  if (isRedirecting) {
    console.log('[Auth] Already redirecting, skipping...')
    return false
  }
  isRedirecting = true
  
  console.log('[Auth] Session expired, redirecting to login...')
  
  // Clear all auth data from localStorage
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  localStorage.removeItem('userId')
  
  // Clear cookie
  document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  
  // Reset flag after delay to handle edge cases (module hot reload, etc.)
  setTimeout(() => {
    isRedirecting = false
  }, 5000)
  
  // Use setTimeout to ensure redirect happens after current call stack
  setTimeout(() => {
    window.location.href = '/login'
  }, 0)
  
  return true
}

/**
 * Authenticated fetch wrapper that handles 401 responses
 * Use this for manual fetch calls instead of plain fetch
 * 
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options (headers, method, body, etc.)
 * @returns {Promise<Response>} Fetch response
 */
export async function authedFetch(url, options = {}) {
  const token = getToken()
  
  const headers = {
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  
  const response = await fetch(url, { ...options, headers })
  
  // Handle 401 Unauthorized - session expired
  if (response.status === 401) {
    handleSessionExpired()
  }
  
  return response
}

/**
 * Sync user data in localStorage with fresh employee data
 * @param {Object} employeeData - Fresh employee data from API
 */
export function syncUserData(employeeData) {
  if (!employeeData) return
  
  try {
    const currentUser = getCurrentUser()
    if (!currentUser) return
    
    const syncedUser = {
      ...currentUser,
      firstName: employeeData.firstName,
      lastName: employeeData.lastName,
      fullName: `${employeeData.firstName} ${employeeData.lastName}`,
      profilePicture: employeeData.profilePicture,
      designation: employeeData.designation,
      department: employeeData.department,
      employeeCode: employeeData.employeeCode,
      phone: employeeData.phone,
      status: employeeData.status,
      // Update employeeId object with fresh data
      employeeId: {
        ...(typeof currentUser.employeeId === 'object' ? currentUser.employeeId : {}),
        _id: employeeData._id || currentUser.employeeId?._id || currentUser.employeeId,
        id: employeeData._id || currentUser.employeeId?._id || currentUser.employeeId,
        firstName: employeeData.firstName,
        lastName: employeeData.lastName,
        fullName: `${employeeData.firstName} ${employeeData.lastName}`,
        email: employeeData.email,
        designation: employeeData.designation,
        department: employeeData.department,
        profilePicture: employeeData.profilePicture,
        status: employeeData.status,
      }
    }
    
    localStorage.setItem('user', JSON.stringify(syncedUser))

    // Notify mounted components to refresh user state immediately.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('talio:user-updated', { detail: syncedUser }))
    }

    return syncedUser
  } catch (error) {
    console.error('Error syncing user data:', error)
    return null
  }
}

/**
 * Broadcast current user update to all mounted listeners.
 * Useful after profile edits so UI refreshes without page reload.
 * @param {Object} userData
 */
export function broadcastUserUpdate(userData) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('talio:user-updated', { detail: userData || getCurrentUser() }))
}
