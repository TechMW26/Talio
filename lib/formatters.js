/**
 * Format designation with level name in format: (Level Name) - Title
 * Uses employee's designationLevel/designationLevelName if available, falls back to designation object
 * @param {Object|string} designation - Designation object or string
 * @param {Object} employee - Optional employee object for level override
 * @returns {string} Formatted designation string
 */
export const formatDesignation = (designation, employee = null) => {
  if (!designation) return 'N/A'

  // Handle if designation is a string
  if (typeof designation === 'string') return designation

  // Handle if designation is an object
  // Try to get title from various possible properties
  let title = designation.title || designation.name || ''
  
  // If title is still an object, try to extract string from it
  if (typeof title === 'object' && title !== null) {
    title = title.name || title.title || ''
  }

  // Priority: employee.designationLevelName > employee.designationLevel > designation.levelName > designation.level
  let levelName = ''
  if (employee?.designationLevelName) {
    levelName = employee.designationLevelName
  } else if (employee?.designationLevel) {
    levelName = getLevelNameFromNumber(employee.designationLevel)
  } else if (designation.levelName) {
    levelName = designation.levelName
  } else if (designation.level) {
    levelName = getLevelNameFromNumber(designation.level)
  }

  // Format: (Level Name) - Title
  if (levelName && title) {
    return `(${levelName}) - ${title}`
  }

  return title || 'N/A'
}

/**
 * Get level name from level number
 * @param {number} level - Level number (1-8)
 * @returns {string} Level name
 */
export const getLevelNameFromNumber = (level) => {
  const levelMap = {
    1: 'Entry Level',
    2: 'Junior',
    3: 'Mid Level',
    4: 'Senior',
    5: 'Lead',
    6: 'Manager',
    7: 'Director',
    8: 'Executive'
  }
  return levelMap[level] || ''
}

/**
 * Format departments - handles both single department (legacy) and multiple departments array
 * @param {Object} employee - Employee object with department and/or departments fields
 * @returns {string} Formatted department names
 */
export const formatDepartments = (employee) => {
  if (!employee) return 'N/A'

  // Check for multiple departments array first
  if (employee.departments && Array.isArray(employee.departments) && employee.departments.length > 0) {
    const deptNames = employee.departments
      .map(dept => {
        // Handle ObjectId string (24 char hex)
        if (typeof dept === 'string') {
          if (dept.length === 24 && /^[0-9a-fA-F]{24}$/.test(dept)) {
            return null // Skip ObjectId strings
          }
          return dept
        }
        // Handle populated department object
        return dept?.name || dept?.code || null
      })
      .filter(Boolean)

    if (deptNames.length > 0) {
      return deptNames.join(', ')
    }
  }

  // Fall back to single department (legacy)
  if (employee.department) {
    // Handle ObjectId string (24 char hex)
    if (typeof employee.department === 'string') {
      if (employee.department.length === 24 && /^[0-9a-fA-F]{24}$/.test(employee.department)) {
        return 'N/A' // Skip ObjectId string
      }
      return employee.department
    }
    // Handle populated department object
    return employee.department?.name || employee.department?.code || 'N/A'
  }

  return 'N/A'
}

/**
 * Get primary department from employee
 * @param {Object} employee - Employee object
 * @returns {Object|null} Primary department object
 */
export const getPrimaryDepartment = (employee) => {
  if (!employee) return null

  // First department in array is primary
  if (employee.departments && Array.isArray(employee.departments) && employee.departments.length > 0) {
    return employee.departments[0]
  }

  // Fall back to legacy single department
  return employee.department || null
}

/**
 * Format employee full name
 * @param {Object} employee - Employee object with firstName and lastName
 * @returns {string} Full name
 */
export const formatEmployeeName = (employee) => {
  if (!employee) return 'N/A'
  const firstName = employee.firstName || ''
  const lastName = employee.lastName || ''
  return `${firstName} ${lastName}`.trim() || 'N/A'
}

/**
 * Get designation level info from employee
 * @param {Object} employee - Employee object
 * @returns {Object} Level info with level number and name
 */
export const getDesignationLevel = (employee) => {
  if (!employee) return { level: 1, levelName: 'Entry Level' }

  // Priority: direct fields on employee > designation object
  const level = employee.designationLevel || employee.designation?.level || 1
  const levelName = employee.designationLevelName ||
    employee.designation?.levelName ||
    getLevelNameFromNumber(level)

  return { level, levelName }
}

