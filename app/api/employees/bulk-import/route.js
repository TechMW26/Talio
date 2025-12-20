import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import Employee from '@/models/Employee'
import User from '@/models/User'
import Department from '@/models/Department'
import Designation from '@/models/Designation'
import Company from '@/models/Company'
import queryCache from '@/lib/queryCache'
import * as XLSX from 'xlsx'
import { sendAndLogOnboardingEmail } from '@/lib/mailer'
import { generateContent } from '@/lib/gemini'

// Ensure models are registered
const _ensureModels = { Department, Designation, Company }

/**
 * Target fields we want to map from any Excel sheet
 */
const TARGET_FIELDS = [
  { name: 'employeeCode', description: 'Employee ID, Staff ID, Emp Code, Employee Number', required: false },
  { name: 'firstName', description: 'First name of the employee', required: false },
  { name: 'lastName', description: 'Last name, surname, family name', required: false },
  { name: 'fullName', description: 'Full name (if first/last are combined)', required: false },
  { name: 'email', description: 'Email address', required: true },
  { name: 'phone', description: 'Phone number, mobile, contact number', required: false },
  { name: 'dateOfBirth', description: 'Date of birth, DOB, birthday', required: false },
  { name: 'dateOfJoining', description: 'Joining date, hire date, start date', required: false },
  { name: 'gender', description: 'Gender, sex (M/F/Male/Female)', required: false },
  { name: 'department', description: 'Department name', required: false },
  { name: 'designation', description: 'Job title, position, role, designation', required: false },
  { name: 'employmentType', description: 'Employment type (full-time, part-time, contract)', required: false },
  { name: 'company', description: 'Company name', required: false },
  { name: 'role', description: 'System role (admin, hr, manager, employee)', required: false },
  { name: 'salary', description: 'Salary, CTC, compensation', required: false },
  { name: 'address', description: 'Address, location', required: false },
]

/**
 * Convert Excel serial date number to JavaScript Date
 * Excel uses days since Jan 1, 1900 (with a bug treating 1900 as leap year)
 */
function excelSerialToDate(serial) {
  if (typeof serial !== 'number' || isNaN(serial) || serial < 1) {
    return null
  }
  
  // Excel's epoch is January 1, 1900
  // But Excel incorrectly treats 1900 as a leap year, so we need to adjust for dates after Feb 28, 1900
  const excelEpoch = new Date(Date.UTC(1899, 11, 30)) // Dec 30, 1899
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  
  // For serial numbers > 60 (after Feb 28, 1900), subtract 1 to account for Excel's leap year bug
  const adjustedSerial = serial > 60 ? serial - 1 : serial
  
  const date = new Date(excelEpoch.getTime() + adjustedSerial * millisecondsPerDay)
  return date
}

/**
 * Parse various date formats from Excel
 * Handles: Excel serial numbers, ISO strings, DD/MM/YYYY, MM/DD/YYYY, etc.
 */
function parseExcelDate(value) {
  if (!value && value !== 0) return null
  
  // If it's already a Date object
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value
  }
  
  // If it's a number (Excel serial date)
  if (typeof value === 'number') {
    // Check if it looks like an Excel serial date (reasonable range: 1900-2100)
    // Serial 1 = Jan 1, 1900, Serial 73050 = Jan 1, 2100
    if (value >= 1 && value <= 73050) {
      return excelSerialToDate(value)
    }
    // Could be a timestamp in milliseconds
    if (value > 1000000000000) {
      return new Date(value)
    }
    // Could be a timestamp in seconds
    if (value > 1000000000) {
      return new Date(value * 1000)
    }
    return null
  }
  
  // If it's a string
  if (typeof value === 'string') {
    const trimmed = value.trim()
    
    // Check if it's a numeric string (Excel serial)
    const numericValue = parseFloat(trimmed)
    if (!isNaN(numericValue) && /^\d+(\.\d+)?$/.test(trimmed)) {
      if (numericValue >= 1 && numericValue <= 73050) {
        return excelSerialToDate(numericValue)
      }
    }
    
    // Try ISO format first
    let parsed = new Date(trimmed)
    if (!isNaN(parsed.getTime())) {
      return parsed
    }
    
    // Try DD/MM/YYYY or DD-MM-YYYY format
    const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
    if (ddmmyyyyMatch) {
      const [, day, month, year] = ddmmyyyyMatch
      parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
      if (!isNaN(parsed.getTime())) {
        return parsed
      }
    }
    
    // Try YYYY/MM/DD or YYYY-MM-DD format
    const yyyymmddMatch = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/)
    if (yyyymmddMatch) {
      const [, year, month, day] = yyyymmddMatch
      parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
      if (!isNaN(parsed.getTime())) {
        return parsed
      }
    }
    
    // Try MM/DD/YYYY format (US format)
    const mmddyyyyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
    if (mmddyyyyMatch) {
      const [, month, day, year] = mmddyyyyMatch
      // Only use this if month is valid (1-12)
      if (parseInt(month) <= 12) {
        parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
        if (!isNaN(parsed.getTime())) {
          return parsed
        }
      }
    }
  }
  
  return null
}

/**
 * Use AI to intelligently map Excel columns to our target fields
 * Analyzes headers AND sample data to understand column content
 */
async function aiMapColumns(headers, sampleRows) {
  try {
    // Build a sample of what each column contains
    const columnSamples = headers.map((header, idx) => {
      const samples = sampleRows
        .slice(0, 5)
        .map(row => row[idx])
        .filter(v => v !== undefined && v !== null && v !== '')
        .slice(0, 3)
      return {
        index: idx,
        header: header || `Column ${idx + 1}`,
        samples: samples.map(s => String(s).substring(0, 50))
      }
    })

    const prompt = `You are analyzing an Excel sheet for employee data import. 
    
Here are the columns with their headers and sample values:
${columnSamples.map(c => `Column ${c.index}: Header="${c.header}", Samples=[${c.samples.map(s => `"${s}"`).join(', ')}]`).join('\n')}

Map each column to ONE of these target fields (or "ignore" if not relevant):
${TARGET_FIELDS.map(f => `- ${f.name}: ${f.description}`).join('\n')}
- ignore: Column is not needed for employee import (e.g., serial numbers, internal IDs, timestamps, etc.)

IMPORTANT RULES:
1. "fullName" should be used when first and last names are combined in one column
2. If you see a column with email patterns (@), map to "email"
3. If you see numeric serial numbers (1-73050 range), those might be Excel dates
4. Employee codes/IDs are alphanumeric identifiers like "EMP001", "STF-123"
5. Phone numbers have 10+ digits or include country codes
6. Map "Name" or "Employee Name" to "fullName"
7. Serial number columns (1, 2, 3...) should be "ignore"

Return ONLY a JSON object mapping column indices to field names. Example:
{"0": "ignore", "1": "fullName", "2": "email", "3": "phone", "4": "dateOfJoining", "5": "department"}

JSON response:`

    const response = await generateContent(prompt, 'You are a data mapping assistant. Return only valid JSON.')
    
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const mapping = JSON.parse(jsonMatch[0])
      console.log('[AI Column Mapping]:', mapping)
      return mapping
    }
  } catch (error) {
    console.error('[AI Column Mapping Error]:', error.message)
  }
  
  return null
}

/**
 * Fallback rule-based column mapping
 */
function ruleBasedColumnMapping(headers, sampleRows) {
  const mapping = {}
  
  const patterns = {
    employeeCode: /^(emp|employee|staff|id|code|number|no\.?|#)[\s_-]*(id|code|no\.?|number|#)?$/i,
    firstName: /^(first|given)[\s_-]*(name)?$/i,
    lastName: /^(last|sur|family)[\s_-]*(name)?$/i,
    fullName: /^(full[\s_-]*name|name|employee[\s_-]*name)$/i,
    email: /^(e[\s_-]*mail|email[\s_-]*(id|address)?|mail)$/i,
    phone: /^(phone|mobile|cell|contact|tel)[\s_-]*(no\.?|number)?$/i,
    dateOfBirth: /^(d\.?o\.?b\.?|date[\s_-]*of[\s_-]*birth|birth[\s_-]*(date|day)?|birthday)$/i,
    dateOfJoining: /^(d\.?o\.?j\.?|date[\s_-]*of[\s_-]*join|join[\s_-]*(date|ing)|hire[\s_-]*date|start[\s_-]*date)$/i,
    gender: /^(gender|sex)$/i,
    department: /^(dept\.?|department)$/i,
    designation: /^(designation|title|position|role|job[\s_-]*(title)?|post)$/i,
    employmentType: /^(employment[\s_-]*type|type|status|emp[\s_-]*type)$/i,
    company: /^(company|organization|org|employer)$/i,
    salary: /^(salary|ctc|compensation|pay|wage)$/i,
    address: /^(address|location|city)$/i,
  }
  
  headers.forEach((header, idx) => {
    if (!header) {
      // Check sample data to infer type
      const samples = sampleRows.slice(0, 5).map(row => row[idx]).filter(v => v)
      
      // Check if all samples look like emails
      if (samples.every(s => String(s).includes('@'))) {
        mapping[idx] = 'email'
        return
      }
      
      // Check if all samples look like phone numbers
      if (samples.every(s => /^[\d\s\-\+\(\)]{10,}$/.test(String(s)))) {
        mapping[idx] = 'phone'
        return
      }
      
      mapping[idx] = 'ignore'
      return
    }
    
    const normalizedHeader = header.toString().toLowerCase().trim()
    
    // Check patterns
    for (const [field, pattern] of Object.entries(patterns)) {
      if (pattern.test(normalizedHeader)) {
        mapping[idx] = field
        return
      }
    }
    
    // Check for partial matches
    if (normalizedHeader.includes('email') || normalizedHeader.includes('mail')) {
      mapping[idx] = 'email'
    } else if (normalizedHeader.includes('phone') || normalizedHeader.includes('mobile')) {
      mapping[idx] = 'phone'
    } else if (normalizedHeader.includes('birth') || normalizedHeader === 'dob') {
      mapping[idx] = 'dateOfBirth'
    } else if (normalizedHeader.includes('join') || normalizedHeader === 'doj') {
      mapping[idx] = 'dateOfJoining'
    } else if (normalizedHeader.includes('name')) {
      if (normalizedHeader.includes('first')) {
        mapping[idx] = 'firstName'
      } else if (normalizedHeader.includes('last') || normalizedHeader.includes('sur')) {
        mapping[idx] = 'lastName'
      } else {
        mapping[idx] = 'fullName'
      }
    } else if (normalizedHeader.includes('dept')) {
      mapping[idx] = 'department'
    } else if (normalizedHeader.includes('design') || normalizedHeader.includes('title') || normalizedHeader.includes('position')) {
      mapping[idx] = 'designation'
    } else if (normalizedHeader === 'gender' || normalizedHeader === 'sex') {
      mapping[idx] = 'gender'
    } else {
      // Check sample data
      const samples = sampleRows.slice(0, 5).map(row => row[idx]).filter(v => v)
      if (samples.every(s => String(s).includes('@'))) {
        mapping[idx] = 'email'
      } else if (samples.every(s => /^[\d\s\-\+\(\)]{10,}$/.test(String(s)))) {
        mapping[idx] = 'phone'
      } else {
        mapping[idx] = 'ignore'
      }
    }
  })
  
  return mapping
}

/**
 * Get the best column mapping (AI first, fallback to rules)
 */
async function getColumnMapping(headers, sampleRows) {
  // Try AI mapping first
  const aiMapping = await aiMapColumns(headers, sampleRows)
  if (aiMapping && Object.keys(aiMapping).length > 0) {
    return { mapping: aiMapping, method: 'ai' }
  }
  
  // Fallback to rule-based mapping
  const ruleMapping = ruleBasedColumnMapping(headers, sampleRows)
  return { mapping: ruleMapping, method: 'rules' }
}

/**
 * Parse row using AI-detected column mapping
 */
function parseRowWithMapping(row, mapping) {
  const data = {}
  
  for (const [colIdx, fieldName] of Object.entries(mapping)) {
    if (fieldName === 'ignore' || fieldName === 'null') continue
    
    const idx = parseInt(colIdx)
    let value = row[idx]
    
    if (value === undefined || value === null || value === '') continue
    
    // Convert to string and trim for string fields
    if (typeof value === 'string') {
      value = value.trim()
    }
    
    // Handle split fields (like "split:firstName,lastName")
    if (fieldName.startsWith('split:')) {
      const fields = fieldName.replace('split:', '').split(',')
      const nameParts = String(value).trim().split(/\s+/)
      if (fields.length >= 2 && nameParts.length >= 1) {
        data[fields[0]] = nameParts[0] || ''
        data[fields[1]] = nameParts.slice(1).join(' ') || ''
      }
      continue
    }
    
    // Handle fullName - split into firstName and lastName
    if (fieldName === 'fullName') {
      const nameParts = String(value).trim().split(/\s+/)
      if (nameParts.length >= 2) {
        data.firstName = nameParts[0]
        data.lastName = nameParts.slice(1).join(' ')
      } else {
        data.firstName = nameParts[0]
        data.lastName = ''
      }
      continue
    }
    
    // Parse dates
    if (fieldName === 'dateOfBirth' || fieldName === 'dateOfJoining') {
      value = parseExcelDate(value)
    }
    
    // Normalize gender
    if (fieldName === 'gender' && value) {
      const normalized = String(value).toLowerCase()
      if (normalized === 'm' || normalized === 'male') {
        value = 'male'
      } else if (normalized === 'f' || normalized === 'female') {
        value = 'female'
      } else {
        value = 'other'
      }
    }
    
    // Normalize role
    if (fieldName === 'role' && value) {
      const normalized = String(value).toLowerCase()
      if (['admin', 'hr', 'manager', 'employee', 'department_head'].includes(normalized)) {
        value = normalized
      } else {
        value = 'employee'
      }
    }
    
    // Normalize employment type
    if (fieldName === 'employmentType' && value) {
      const normalized = String(value).toLowerCase().replace(/\s+/g, '-')
      if (['full-time', 'part-time', 'contract', 'intern'].includes(normalized)) {
        value = normalized
      } else if (normalized.includes('full')) {
        value = 'full-time'
      } else if (normalized.includes('part')) {
        value = 'part-time'
      } else {
        value = 'full-time'
      }
    }
    
    data[fieldName] = value
  }
  
  return data
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
  const s1 = str1.toLowerCase()
  const s2 = str2.toLowerCase()
  
  const matrix = []
  
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i]
  }
  
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j
  }
  
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        )
      }
    }
  }
  
  return matrix[s1.length][s2.length]
}

/**
 * Calculate similarity ratio (0 to 1)
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0
  const maxLen = Math.max(str1.length, str2.length)
  if (maxLen === 0) return 1
  const distance = levenshteinDistance(str1, str2)
  return (maxLen - distance) / maxLen
}

/**
 * Common abbreviation mappings for fuzzy matching
 */
const ABBREVIATION_MAP = {
  'hr': 'human resources',
  'it': 'information technology',
  'r&d': 'research and development',
  'qa': 'quality assurance',
  'pr': 'public relations',
  'cs': 'customer service',
  'ops': 'operations',
  'eng': 'engineering',
  'mkt': 'marketing',
  'fin': 'finance',
  'admin': 'administration',
  'exec': 'executive',
  'mgmt': 'management',
  'dev': 'development',
  'tech': 'technology',
}

/**
 * Normalize text for comparison (expand abbreviations, remove special chars)
 */
function normalizeForComparison(text) {
  if (!text) return ''
  let normalized = text.toLowerCase().trim()
  
  // Expand known abbreviations
  Object.entries(ABBREVIATION_MAP).forEach(([abbr, full]) => {
    if (normalized === abbr || normalized.startsWith(abbr + ' ') || normalized.endsWith(' ' + abbr)) {
      normalized = normalized.replace(new RegExp(`\\b${abbr}\\b`, 'gi'), full)
    }
  })
  
  // Remove special characters and extra spaces
  normalized = normalized.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  
  return normalized
}

/**
 * Find best matching department with fuzzy matching
 * Returns { department, isExact, similarity } or null
 */
function findBestMatchingDepartment(searchName, departments, threshold = 0.75) {
  if (!searchName) return null
  
  const normalizedSearch = normalizeForComparison(searchName)
  let bestMatch = null
  let bestSimilarity = 0
  
  for (const dept of departments) {
    // Check exact match first
    const normalizedDept = normalizeForComparison(dept.name)
    if (normalizedDept === normalizedSearch) {
      return { department: dept, isExact: true, similarity: 1 }
    }
    
    // Check code match
    if (dept.code && dept.code.toLowerCase() === searchName.toLowerCase().trim()) {
      return { department: dept, isExact: true, similarity: 1 }
    }
    
    // Calculate similarity
    const similarity = calculateSimilarity(normalizedSearch, normalizedDept)
    if (similarity > bestSimilarity && similarity >= threshold) {
      bestSimilarity = similarity
      bestMatch = { department: dept, isExact: false, similarity }
    }
  }
  
  return bestMatch
}

/**
 * Find best matching designation with fuzzy matching
 */
function findBestMatchingDesignation(searchTitle, designations, threshold = 0.75) {
  if (!searchTitle) return null
  
  const normalizedSearch = normalizeForComparison(searchTitle)
  let bestMatch = null
  let bestSimilarity = 0
  
  for (const desig of designations) {
    const normalizedDesig = normalizeForComparison(desig.title)
    if (normalizedDesig === normalizedSearch) {
      return { designation: desig, isExact: true, similarity: 1 }
    }
    
    if (desig.code && desig.code.toLowerCase() === searchTitle.toLowerCase().trim()) {
      return { designation: desig, isExact: true, similarity: 1 }
    }
    
    const similarity = calculateSimilarity(normalizedSearch, normalizedDesig)
    if (similarity > bestSimilarity && similarity >= threshold) {
      bestSimilarity = similarity
      bestMatch = { designation: desig, isExact: false, similarity }
    }
  }
  
  return bestMatch
}

/**
 * Generate a department code from name
 */
function generateDepartmentCode(name) {
  if (!name) return 'DEPT'
  const words = name.trim().split(/\s+/)
  if (words.length === 1) {
    return words[0].substring(0, 4).toUpperCase()
  }
  return words.map(w => w[0]).join('').toUpperCase().substring(0, 6)
}

/**
 * Generate a designation code from title
 */
function generateDesignationCode(title) {
  if (!title) return 'DESIG'
  const words = title.trim().split(/\s+/)
  if (words.length === 1) {
    return words[0].substring(0, 4).toUpperCase()
  }
  return words.map(w => w[0]).join('').toUpperCase().substring(0, 6)
}

/**
 * Create or find department with fuzzy matching
 */
async function getOrCreateDepartment(name, allDepartments) {
  if (!name) return { departmentId: null, created: false, matched: null }
  
  const match = findBestMatchingDepartment(name, allDepartments)
  
  if (match) {
    return { 
      departmentId: match.department._id, 
      created: false, 
      matched: match.department.name,
      similarity: match.similarity,
      isExact: match.isExact
    }
  }
  
  // Create new department
  const code = generateDepartmentCode(name)
  let uniqueCode = code
  let counter = 1
  
  // Ensure unique code
  while (allDepartments.some(d => d.code === uniqueCode)) {
    uniqueCode = `${code}${counter}`
    counter++
  }
  
  const newDept = await Department.create({
    name: name.trim(),
    code: uniqueCode,
    description: `Department for ${name.trim()} operations`,
    isActive: true
  })
  
  // Add to cache
  allDepartments.push({ _id: newDept._id, name: newDept.name, code: newDept.code })
  
  return { departmentId: newDept._id, created: true, matched: name.trim() }
}

/**
 * Create or find designation with fuzzy matching
 */
async function getOrCreateDesignation(title, allDesignations) {
  if (!title) return { designationId: null, created: false, matched: null }
  
  const match = findBestMatchingDesignation(title, allDesignations)
  
  if (match) {
    return { 
      designationId: match.designation._id, 
      created: false, 
      matched: match.designation.title,
      similarity: match.similarity,
      isExact: match.isExact
    }
  }
  
  // Create new designation
  const code = generateDesignationCode(title)
  let uniqueCode = code
  let counter = 1
  
  // Ensure unique code
  while (allDesignations.some(d => d.code === uniqueCode)) {
    uniqueCode = `${code}${counter}`
    counter++
  }
  
  const newDesig = await Designation.create({
    title: title.trim(),
    code: uniqueCode,
    description: `${title.trim()} position`,
    level: 1,
    isActive: true
  })
  
  // Add to cache
  allDesignations.push({ _id: newDesig._id, title: newDesig.title, code: newDesig.code })
  
  return { designationId: newDesig._id, created: true, matched: title.trim() }
}

/**
 * Helper function to create or update a single employee and user account
 * Now supports upsert by email
 */
async function createOrUpdateEmployeeAndUser(data, allDepartments, allDesignations, companyMap) {
  const warnings = []
  
  // Email is required for deduplication
  if (!data.email) {
    return { success: false, errors: ['Email is required'], action: 'skipped' }
  }

  const email = data.email.toLowerCase().trim()
  
  // Check for existing employee by email
  const existingEmployee = await Employee.findOne({ email }).lean()
  const existingUser = await User.findOne({ email }).lean()
  
  // Handle department with fuzzy matching
  let departmentResult = { departmentId: null, created: false }
  if (data.department && typeof data.department === 'string') {
    departmentResult = await getOrCreateDepartment(data.department, allDepartments)
    if (departmentResult.created) {
      warnings.push(`Created new department: "${departmentResult.matched}"`)
    } else if (!departmentResult.isExact && departmentResult.similarity < 1) {
      warnings.push(`Matched department "${data.department}" to existing "${departmentResult.matched}" (${Math.round(departmentResult.similarity * 100)}% match)`)
    }
  }
  
  // Handle designation with fuzzy matching
  let designationResult = { designationId: null, created: false }
  if (data.designation && typeof data.designation === 'string') {
    designationResult = await getOrCreateDesignation(data.designation, allDesignations)
    if (designationResult.created) {
      warnings.push(`Created new designation: "${designationResult.matched}"`)
    } else if (!designationResult.isExact && designationResult.similarity < 1) {
      warnings.push(`Matched designation "${data.designation}" to existing "${designationResult.matched}" (${Math.round(designationResult.similarity * 100)}% match)`)
    }
  }
  
  // Map company name to ID if provided as string
  let companyId = null
  if (data.company && typeof data.company === 'string') {
    companyId = companyMap.get(data.company.toLowerCase().trim())
  }

  // Prepare employee data - only include non-empty fields
  const employeeData = {}
  
  // Map fields, only setting if they have values
  if (data.employeeCode) employeeData.employeeCode = data.employeeCode
  if (data.firstName) employeeData.firstName = data.firstName
  if (data.lastName) employeeData.lastName = data.lastName
  employeeData.email = email
  if (data.phone) employeeData.phone = data.phone
  if (data.dateOfBirth) employeeData.dateOfBirth = data.dateOfBirth
  if (data.dateOfJoining) employeeData.dateOfJoining = data.dateOfJoining
  if (data.gender) employeeData.gender = data.gender
  if (data.employmentType) employeeData.employmentType = data.employmentType
  if (data.status) employeeData.status = data.status
  if (departmentResult.departmentId) {
    employeeData.department = departmentResult.departmentId
    employeeData.departments = [departmentResult.departmentId]
  }
  if (designationResult.designationId) {
    employeeData.designation = designationResult.designationId
  }
  if (companyId) employeeData.company = companyId
  if (data.designationLevel) employeeData.designationLevel = parseInt(data.designationLevel) || 1
  if (data.designationLevelName) employeeData.designationLevelName = data.designationLevelName
  
  // Handle salary fields
  if (data.salary || data.basicSalary || data.grossSalary || data.ctc) {
    employeeData.salary = {
      ...(existingEmployee?.salary || {}),
      basic: data.basicSalary || data.salary || existingEmployee?.salary?.basic,
      grossSalary: data.grossSalary || existingEmployee?.salary?.grossSalary,
      ctc: data.ctc || existingEmployee?.salary?.ctc,
    }
  }

  let employee
  let user
  let action
  
  if (existingEmployee) {
    // UPDATE existing employee - merge new data with existing (preserve existing if not provided in new data)
    const updateData = {}
    
    Object.entries(employeeData).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        // Only update if new value is provided
        updateData[key] = value
      }
    })
    
    employee = await Employee.findByIdAndUpdate(
      existingEmployee._id,
      { $set: updateData },
      { new: true }
    )
    
    action = 'updated'
    
    // Update user if exists
    if (existingUser) {
      const userUpdateData = {}
      if (data.role && data.role !== existingUser.role) {
        userUpdateData.role = data.role
      }
      if (departmentResult.departmentId) {
        userUpdateData.department = departmentResult.departmentId
      }
      if (companyId) {
        userUpdateData.company = companyId
      }
      
      if (Object.keys(userUpdateData).length > 0) {
        user = await User.findByIdAndUpdate(
          existingUser._id,
          { $set: userUpdateData },
          { new: true }
        )
      } else {
        user = existingUser
      }
    }
  } else {
    // CREATE new employee
    // Generate employee code if not provided
    if (!employeeData.employeeCode) {
      const count = await Employee.countDocuments()
      employeeData.employeeCode = `EMP${String(count + 1).padStart(4, '0')}`
      warnings.push(`Auto-generated employee code: ${employeeData.employeeCode}`)
    }
    
    // Set defaults for required fields if not provided
    if (!employeeData.firstName) {
      employeeData.firstName = email.split('@')[0]
      warnings.push('First name not provided, using email prefix')
    }
    if (!employeeData.lastName) {
      employeeData.lastName = '-'
      warnings.push('Last name not provided, using placeholder')
    }
    
    // Check if employee code already exists
    const existingCode = await Employee.findOne({ employeeCode: employeeData.employeeCode }).lean()
    if (existingCode) {
      // Generate unique code
      const count = await Employee.countDocuments()
      employeeData.employeeCode = `EMP${String(count + 1).padStart(4, '0')}-${Date.now().toString(36).slice(-4)}`
      warnings.push(`Employee code was duplicate, generated: ${employeeData.employeeCode}`)
    }
    
    try {
      employee = await Employee.create(employeeData)
      action = 'created'
    } catch (error) {
      if (error.code === 11000) {
        // Duplicate key error
        return { 
          success: false, 
          errors: [`Duplicate entry: ${JSON.stringify(error.keyValue)}`], 
          action: 'failed' 
        }
      }
      throw error
    }

    // Create user account for new employee
    const password = data.password || 'employee123'

    const userData = {
      email: email,
      password: password,
      role: data.role || 'employee',
      employeeId: employee._id,
      forcePasswordChange: true,
    }

    if (companyId) userData.company = companyId

    try {
      user = await User.create(userData)
      
      // Update employee with userId reference
      await Employee.findByIdAndUpdate(employee._id, { userId: user._id })
      
      // Get department name for email
      let departmentName = null
      if (departmentResult.departmentId) {
        const dept = await Department.findById(departmentResult.departmentId).select('name').lean()
        departmentName = dept?.name
      }

      // Get designation name for email
      let designationName = null
      if (designationResult.designationId) {
        const desig = await Designation.findById(designationResult.designationId).select('title').lean()
        designationName = desig?.title
      }

      // Send onboarding email (async, don't block)
      sendAndLogOnboardingEmail({
        employeeId: employee._id,
        userId: user._id,
        to: email,
        firstName: employeeData.firstName,
        lastName: employeeData.lastName,
        email: email,
        password: password,
        employeeCode: employeeData.employeeCode,
        designation: designationName || employeeData.designationLevelName,
        department: departmentName,
        dateOfJoining: employeeData.dateOfJoining,
        triggeredBy: 'bulk_import',
      }).catch(err => {
        console.error(`[Bulk Import] Failed to send onboarding email to ${email}:`, err)
      })
    } catch (error) {
      // If user creation fails, clean up the employee
      await Employee.findByIdAndDelete(employee._id)
      throw error
    }
  }

  return {
    success: true,
    action,
    employee: {
      _id: employee._id,
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
    },
    warnings,
    credentials: action === 'created' ? {
      email: email,
      password: data.password || 'employee123',
    } : null,
    departmentCreated: departmentResult.created,
    designationCreated: designationResult.created,
  }
}

/**
 * Parse Excel row data into employee object
 */
function parseExcelRow(row, headers) {
  const data = {}
  
  // Map Excel column headers to employee fields
  const columnMapping = {
    'employee code': 'employeeCode',
    'employeecode': 'employeeCode',
    'emp code': 'employeeCode',
    'emp_code': 'employeeCode',
    'first name': 'firstName',
    'firstname': 'firstName',
    'first_name': 'firstName',
    'last name': 'lastName',
    'lastname': 'lastName',
    'last_name': 'lastName',
    'email': 'email',
    'email address': 'email',
    'phone': 'phone',
    'phone number': 'phone',
    'phonenumber': 'phone',
    'mobile': 'phone',
    'date of birth': 'dateOfBirth',
    'dateofbirth': 'dateOfBirth',
    'dob': 'dateOfBirth',
    'date_of_birth': 'dateOfBirth',
    'gender': 'gender',
    'department': 'department',
    'dept': 'department',
    'designation': 'designation',
    'role': 'role',
    'position': 'designation',
    'date of joining': 'dateOfJoining',
    'dateofjoining': 'dateOfJoining',
    'joining date': 'dateOfJoining',
    'joiningdate': 'dateOfJoining',
    'join date': 'dateOfJoining',
    'date_of_joining': 'dateOfJoining',
    'employment type': 'employmentType',
    'employmenttype': 'employmentType',
    'employment_type': 'employmentType',
    'status': 'status',
    'company': 'company',
    'password': 'password',
    'level': 'designationLevel',
    'designation level': 'designationLevel',
    'designationlevel': 'designationLevel',
  }

  headers.forEach((header, index) => {
    const normalizedHeader = header.toLowerCase().trim()
    const fieldName = columnMapping[normalizedHeader] || normalizedHeader
    let value = row[index]
    
    // Skip empty values
    if (value === undefined || value === null || value === '') {
      return
    }

    // Convert to string and trim
    if (typeof value === 'string') {
      value = value.trim()
    }

    // Parse dates - Handle Excel serial numbers and various string formats
    if (fieldName === 'dateOfBirth' || fieldName === 'dateOfJoining') {
      value = parseExcelDate(value)
    }

    // Normalize gender
    if (fieldName === 'gender' && typeof value === 'string') {
      const normalized = value.toLowerCase()
      if (normalized === 'm' || normalized === 'male') {
        value = 'male'
      } else if (normalized === 'f' || normalized === 'female') {
        value = 'female'
      } else {
        value = 'other'
      }
    }

    // Normalize status
    if (fieldName === 'status' && typeof value === 'string') {
      const normalized = value.toLowerCase()
      if (normalized === 'active' || normalized === '1' || normalized === 'yes') {
        value = 'active'
      } else {
        value = 'inactive'
      }
    }

    // Normalize role
    if (fieldName === 'role' && typeof value === 'string') {
      const normalized = value.toLowerCase()
      if (['admin', 'hr', 'manager', 'employee'].includes(normalized)) {
        value = normalized
      } else {
        value = 'employee'
      }
    }

    // Normalize employment type
    if (fieldName === 'employmentType' && typeof value === 'string') {
      const normalized = value.toLowerCase().replace(/\s+/g, '-')
      if (['full-time', 'part-time', 'contract', 'intern'].includes(normalized)) {
        value = normalized
      } else {
        value = 'full-time'
      }
    }

    data[fieldName] = value
  })

  return data
}

/**
 * POST - Bulk import employees from Excel file
 */
export async function POST(request) {
  try {
    await connectDB()

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file')
    
    if (!file) {
      return NextResponse.json(
        { success: false, message: 'No file uploaded' },
        { status: 400 }
      )
    }

    // Validate file type
    const fileName = file.name || ''
    if (!fileName.match(/\.(xlsx|xls)$/i)) {
      return NextResponse.json(
        { success: false, message: 'Invalid file format. Please upload an Excel file (.xlsx or .xls)' },
        { status: 400 }
      )
    }

    // Read file content
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    // Parse Excel file
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    
    // Convert to array of arrays (with header)
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' })
    
    if (rawData.length < 2) {
      return NextResponse.json(
        { success: false, message: 'Excel file is empty or has no data rows' },
        { status: 400 }
      )
    }

    const headers = rawData[0]
    const dataRows = rawData.slice(1).filter(row => row.some(cell => cell !== undefined && cell !== null && cell !== ''))

    if (dataRows.length === 0) {
      return NextResponse.json(
        { success: false, message: 'No valid data rows found in the Excel file' },
        { status: 400 }
      )
    }

    // Use AI to detect column mapping
    console.log('[Bulk Import] Analyzing Excel structure with AI...')
    const { mapping: columnMapping, method: mappingMethod } = await getColumnMapping(headers, dataRows)
    console.log(`[Bulk Import] Column mapping detected using ${mappingMethod}:`, columnMapping)

    // Check if we have at least an email column mapped
    const hasEmailColumn = Object.values(columnMapping).includes('email')
    const hasNameColumn = Object.values(columnMapping).some(v => ['firstName', 'lastName', 'fullName'].includes(v))
    
    if (!hasEmailColumn) {
      return NextResponse.json(
        { success: false, message: 'Could not detect an email column in the Excel file. Email is required for each employee.' },
        { status: 400 }
      )
    }

    // Fetch departments, designations, and companies for mapping
    const [departments, designations, companies] = await Promise.all([
      Department.find({}).select('_id name code').lean(),
      Designation.find({}).select('_id title code').lean(),
      Company.find({}).select('_id name code').lean()
    ])

    // Create mutable arrays for dynamic creation
    const allDepartments = [...departments]
    const allDesignations = [...designations]

    // Create company lookup map (case-insensitive)
    const companyMap = new Map()
    companies.forEach(comp => {
      companyMap.set(comp.name.toLowerCase(), comp._id)
      if (comp.code) {
        companyMap.set(comp.code.toLowerCase(), comp._id)
      }
    })

    // Process each row
    const results = {
      total: dataRows.length,
      created: [],
      updated: [],
      failed: [],
      departmentsCreated: 0,
      designationsCreated: 0,
      warnings: [],
      mappingMethod,
      detectedColumns: Object.entries(columnMapping)
        .filter(([_, field]) => field !== 'ignore')
        .map(([idx, field]) => ({ column: headers[parseInt(idx)] || `Column ${parseInt(idx) + 1}`, field }))
    }

    for (let i = 0; i < dataRows.length; i++) {
      const rowNumber = i + 2 // Account for header row and 1-based indexing
      const row = dataRows[i]
      
      try {
        // Use AI-detected mapping to parse row
        const employeeData = parseRowWithMapping(row, columnMapping)
        
        // Skip completely empty rows
        if (!employeeData.email && !employeeData.employeeCode && !employeeData.firstName) {
          continue
        }

        const result = await createOrUpdateEmployeeAndUser(
          employeeData,
          allDepartments,
          allDesignations,
          companyMap
        )

        if (result.success) {
          const resultData = {
            rowNumber,
            employeeCode: result.employee.employeeCode,
            name: `${result.employee.firstName} ${result.employee.lastName}`,
            email: result.employee.email,
            warnings: result.warnings || [],
          }
          
          if (result.action === 'created') {
            resultData.credentials = result.credentials
            results.created.push(resultData)
          } else {
            results.updated.push(resultData)
          }
          
          if (result.departmentCreated) results.departmentsCreated++
          if (result.designationCreated) results.designationsCreated++
          
        } else {
          results.failed.push({
            rowNumber,
            employeeCode: employeeData.employeeCode || 'N/A',
            name: employeeData.firstName ? `${employeeData.firstName} ${employeeData.lastName || ''}`.trim() : 'N/A',
            errors: result.errors,
          })
        }
      } catch (error) {
        console.error(`Error processing row ${rowNumber}:`, error)
        results.failed.push({
          rowNumber,
          employeeCode: row[0] || 'N/A',
          name: row[1] ? `${row[1]} ${row[2] || ''}`.trim() : 'N/A',
          errors: [error.message || 'Unknown error occurred'],
        })
      }
    }

    // For backward compatibility, combine created and updated into successful
    results.successful = [...results.created, ...results.updated]

    // Clear employee list cache
    queryCache.clearPattern('employees')

    // Build summary message
    const summaryParts = []
    if (results.created.length > 0) summaryParts.push(`${results.created.length} created`)
    if (results.updated.length > 0) summaryParts.push(`${results.updated.length} updated`)
    if (results.failed.length > 0) summaryParts.push(`${results.failed.length} failed`)
    if (results.departmentsCreated > 0) summaryParts.push(`${results.departmentsCreated} new departments`)
    if (results.designationsCreated > 0) summaryParts.push(`${results.designationsCreated} new designations`)

    return NextResponse.json({
      success: true,
      message: `Bulk import completed: ${summaryParts.join(', ')}`,
      data: results,
    })

  } catch (error) {
    console.error('Bulk import error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to process bulk import' },
      { status: 500 }
    )
  }
}

/**
 * GET - Download sample Excel template
 */
export async function GET(request) {
  try {
    // Create sample data for template
    const sampleData = [
      [
        'Employee Code',
        'First Name',
        'Last Name',
        'Email',
        'Phone',
        'Gender',
        'Date of Birth',
        'Date of Joining',
        'Department',
        'Designation',
        'Role',
        'Employment Type',
        'Status',
        'Company',
        'Password',
      ],
      [
        'EMP001',
        'John',
        'Doe',
        'john.doe@example.com',
        '+1234567890',
        'Male',
        '1990-01-15',
        '2024-01-01',
        'Engineering',
        'Software Engineer',
        'employee',
        'full-time',
        'active',
        'Acme Corp',
        'password123',
      ],
      [
        'EMP002',
        'Jane',
        'Smith',
        'jane.smith@example.com',
        '+0987654321',
        'Female',
        '1992-05-20',
        '2024-02-15',
        'HR',
        'HR Manager',
        'hr',
        'full-time',
        'active',
        'Acme Corp',
        'password456',
      ],
    ]

    // Create workbook
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.aoa_to_sheet(sampleData)

    // Set column widths
    worksheet['!cols'] = [
      { wch: 15 }, // Employee Code
      { wch: 15 }, // First Name
      { wch: 15 }, // Last Name
      { wch: 25 }, // Email
      { wch: 15 }, // Phone
      { wch: 10 }, // Gender
      { wch: 15 }, // Date of Birth
      { wch: 15 }, // Date of Joining
      { wch: 15 }, // Department
      { wch: 20 }, // Designation
      { wch: 12 }, // Role
      { wch: 15 }, // Employment Type
      { wch: 10 }, // Status
      { wch: 15 }, // Company
      { wch: 15 }, // Password
    ]

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Employees')

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

    // Return file
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="employee_import_template.xlsx"',
      },
    })

  } catch (error) {
    console.error('Template generation error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to generate template' },
      { status: 500 }
    )
  }
}
