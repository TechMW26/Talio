import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { generateContent } from '@/lib/gemini'
import { LEVEL_NAMES, inferLevelFromTitle } from '@/lib/designationLevels'

/**
 * Reverse mapping from level name / synonym to canonical level number (1-9).
 */
const LEVEL_NAME_TO_NUMBER = {
  'entry level': 1, 'entry': 1, 'intern': 1, 'internship': 1, 'trainee': 1, 'fresher': 1, 'graduate': 1, 'apprentice': 1, 'junior': 1, 'jr': 1,
  'mid level': 2, 'mid': 2, 'intermediate': 2, 'associate': 2,
  'senior': 3, 'sr': 3, 'experienced': 3,
  'team lead': 4, 'tech lead': 4, 'lead': 4, 'principal': 4, 'supervisor': 4,
  'assistant manager': 5, 'asst manager': 5, 'asst. manager': 5, 'deputy manager': 5,
  'manager': 6, 'mgr': 6, 'senior manager': 6, 'head': 6, 'architect': 6,
  'c-suite': 7, 'csuite': 7, 'executive': 7, 'chief': 7, 'ceo': 7, 'cto': 7, 'cfo': 7, 'coo': 7, 'cmo': 7, 'chro': 7, 'cio': 7, 'ciso': 7, 'cpo': 7, 'president': 7, 'founder': 7,
  'assistant director': 8, 'asst director': 8, 'asst. director': 8,
  'director': 9, 'vp': 9, 'vice president': 9,
}

/**
 * Smart level detection based on designation/job title (uses shared inferLevelFromTitle).
 */
function detectLevelFromDesignation(title) {
  const level = inferLevelFromTitle(title)
  return { level, levelName: LEVEL_NAMES[level] || 'Mid Level' }
}

/**
 * Parse level from Excel value (could be number or string)
 */
function parseLevelFromValue(value) {
  if (!value) return null

  // If it's a number, use it directly when it falls in the 1-9 canonical range
  if (typeof value === 'number' && value >= 1 && value <= 9) {
    return { level: value, levelName: LEVEL_NAMES[value] }
  }

  // If it's a string, try to match level name
  const normalized = String(value).toLowerCase().trim()

  for (const [key, levelNum] of Object.entries(LEVEL_NAME_TO_NUMBER)) {
    if (normalized === key || normalized.includes(key)) {
      return { level: levelNum, levelName: LEVEL_NAMES[levelNum] }
    }
  }

  return null
}

/**
 * Detect user role from designation/job title
 * Only maps: employee, hr, manager (NOT admin - admin must be set manually)
 * Returns display name for preview, will be converted to lowercase for DB
 */
function detectUserRoleFromDesignation(designation, department) {
  if (!designation) return 'employee'
  
  const title = designation.toLowerCase().trim()
  const dept = (department || '').toLowerCase().trim()
  
  // HR roles - only if designation explicitly contains HR-related terms
  // Matches: HR, Human Resource, HR Executive, Associate-HR, AM-HR, HRBP, etc.
  if (/\b(hr|human\s*resource|hrbp|hr\s*business\s*partner)\b/i.test(title) ||
      /[-_](hr|human\s*resource)$/i.test(title) ||
      /^(hr|human\s*resource)[-_]/i.test(title)) {
    return 'hr'
  }
  
  // Also check if department is HR
  if (/\b(hr|human\s*resource)\b/i.test(dept)) {
    return 'hr'
  }
  
  // Manager role - only if designation explicitly contains Manager/Lead terms
  // Matches: Manager, Team Lead, Tech Lead, Project Manager, etc.
  if (/\b(manager|mgr|team\s*lead|tech\s*lead|project\s*lead|engineering\s*lead)\b/i.test(title)) {
    return 'manager'
  }
  
  // Default to employee for all other designations
  return 'employee'
}

/**
 * Target fields we want to extract - our template
 */
const TEMPLATE_FIELDS = [
  { key: 'employeeCode', label: 'Employee Code', description: 'Employee ID, Staff ID' },
  { key: 'firstName', label: 'First Name', description: 'First name' },
  { key: 'lastName', label: 'Last Name', description: 'Surname, family name' },
  { key: 'email', label: 'Email', description: 'Email address', required: true },
  { key: 'phone', label: 'Phone', description: 'Phone number, mobile' },
  { key: 'gender', label: 'Gender', description: 'Male/Female/Other' },
  { key: 'dateOfBirth', label: 'Date of Birth', description: 'DOB, birthday' },
  { key: 'dateOfJoining', label: 'Date of Joining', description: 'Hire date, start date' },
  { key: 'department', label: 'Department', description: 'Department name' },
  { key: 'designation', label: 'Designation', description: 'Job title, position' },
  { key: 'level', label: 'Level', description: 'Employee level (Entry, Mid, Senior, Team Lead, Assistant Manager, Manager, C-Suite, Assistant Director, Director)' },
  { key: 'company', label: 'Company', description: 'Company name' },
  { key: 'employmentType', label: 'Employment Type', description: 'Full-time, part-time, contract' },
  { key: 'grossSalary', label: 'Gross Salary', description: 'Monthly salary, CTC, compensation' },
  { key: 'role', label: 'System Role', description: 'admin, hr, manager, department_head, employee' },
]

/**
 * Convert Excel serial date to readable string
 */
function excelSerialToDateString(serial) {
  if (typeof serial !== 'number' || isNaN(serial) || serial < 1 || serial > 73050) {
    return null
  }
  const excelEpoch = new Date(Date.UTC(1899, 11, 30))
  const msPerDay = 24 * 60 * 60 * 1000
  const adjustedSerial = serial > 60 ? serial - 1 : serial
  const date = new Date(excelEpoch.getTime() + adjustedSerial * msPerDay)
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Format any value for display
 */
function formatValue(value, fieldKey) {
  if (value === undefined || value === null || value === '') return ''
  
  // Handle date fields
  if ((fieldKey === 'dateOfBirth' || fieldKey === 'dateOfJoining') && typeof value === 'number') {
    const dateStr = excelSerialToDateString(value)
    if (dateStr) return dateStr
  }
  
  return String(value).trim()
}

/**
 * Use AI to map columns from uploaded sheet to our template
 */
async function aiMapColumns(headers, sampleRows) {
  try {
    const columnSamples = headers.map((header, idx) => {
      const samples = sampleRows
        .slice(0, 8)
        .map(row => row[idx])
        .filter(v => v !== undefined && v !== null && v !== '')
        .slice(0, 5)
      return {
        index: idx,
        header: header || `Column ${idx + 1}`,
        samples: samples.map(s => String(s).substring(0, 80))
      }
    })

    const targetFieldsList = TEMPLATE_FIELDS.map(f => `- ${f.key}: ${f.description}`).join('\n')

    const prompt = `Analyze this Excel employee data and map columns to our system fields.

COLUMNS IN UPLOADED FILE:
${columnSamples.map(c => `[${c.index}] Header: "${c.header}" | Samples: [${c.samples.map(s => `"${s}"`).join(', ')}]`).join('\n')}

MAP TO THESE FIELDS (use "null" for columns that don't match any field):
${targetFieldsList}

CRITICAL RULES:
1. Column with "Employee Name", "Name", "Full Name", "Emp Name" containing full names like "Amreesh Saxena" → "split:firstName,lastName"
2. "Official Email", "Email ID", "E-mail", "Mail" columns with @ symbols → "email"
3. "Mobile", "Phone", "Contact", "Mobile Number" with 10-digit numbers → "phone"
4. "Employee Code", "Emp Code", "Emp ID", "Staff ID", codes like "A18", "A110", "EMP001" → "employeeCode"
5. Numbers 25000-50000 are Excel serial dates (days since 1900) for DOB/DOJ
6. "Date of Birth", "DOB", "D.O.B", "Birth Date" → "dateOfBirth"
7. "Date of Joining", "DOJ", "D.O.J", "Joining Date", "Hire Date" → "dateOfJoining"
8. "Department", "Dept", "Division" → "department"
9. "Designation", "Title", "Position", "Post", "Job Title" → "designation"
10. M/F/Male/Female in "Gender" or "Sex" column → "gender"
11. "Salary", "CTC", "Gross Salary", "Compensation", "Pay" → "grossSalary"
12. "Employee Type", "Employment Type", "Type" with values like "Full-time", "Employee" → "employmentType"
13. "Employee Level" or columns with values like "Manager", "Employee", "Head" → IGNORE (not system role unless explicitly "System Role", "User Role", "Access Role")
14. IGNORE: Serial/S.No/#/Sl columns, Father's name, Address, Location, Shift, Reporting To
15. "Company", "Organization", "Employer" → "company"

Return ONLY a JSON object mapping column index (as string) to field name or "null":
Example: {"0": "employeeCode", "1": "split:firstName,lastName", "2": "email", "3": "phone", "4": "gender", "5": "department", "6": "designation", "7": "null", "8": "dateOfBirth", "9": "dateOfJoining"}

JSON only:`

    const response = await generateContent(prompt, 'Return only valid JSON object, no markdown, no explanation, no code blocks.')
    
    // Extract JSON from response (handle various formats)
    let jsonStr = response.trim()
    
    // Remove markdown code blocks if present
    jsonStr = jsonStr.replace(/```json\s*/gi, '').replace(/```\s*/gi, '')
    
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      console.log('[AI Mapping Result]:', parsed)
      return parsed
    }
  } catch (error) {
    console.error('[AI Column Mapping Error]:', error.message)
  }
  return null
}

/**
 * Detect field type from sample values
 * This helps when headers are missing or ambiguous
 * SMART DETECTION: Analyzes actual data patterns, not just headers
 */
function detectFieldFromSamples(samples) {
  if (!samples || samples.length === 0) return null
  
  const validSamples = samples.filter(s => s !== undefined && s !== null && s !== '')
  if (validSamples.length === 0) return null
  
  // Convert all samples to strings for pattern matching
  const stringSamples = validSamples.map(s => String(s).trim())
  
  // Check for email pattern - must have @ and . with domain
  const emailMatches = stringSamples.filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
  if (emailMatches.length >= validSamples.length * 0.7) { // 70% must be valid emails
    return 'email'
  }
  
  // Check for phone numbers - 10 digits (Indian format) or international
  const phoneMatches = stringSamples.filter(s => {
    const digits = s.replace(/[\s\-()+ ]/g, '')
    return /^\d{10,15}$/.test(digits)
  })
  if (phoneMatches.length >= validSamples.length * 0.7) {
    return 'phone'
  }
  
  // Check for gender values - very specific values only
  const genderValues = ['m', 'f', 'male', 'female', 'other', 'man', 'woman']
  const genderMatches = stringSamples.filter(s => genderValues.includes(s.toLowerCase()))
  if (genderMatches.length >= validSamples.length * 0.8) { // 80% must be gender values
    return 'gender'
  }
  
  // Check for full names - multiple words, mostly alphabetic, contains space
  // Examples: "Amreesh Saxena", "John Smith", "Ravi Kumar Singh"
  const nameMatches = stringSamples.filter(s => {
    // Must have at least one space (multi-word)
    if (!s.includes(' ')) return false
    // Must be mostly letters and spaces
    const cleaned = s.replace(/[a-zA-Z\s.'\-]/g, '')
    return cleaned.length < s.length * 0.2 // Allow 20% non-letters (for initials like K. etc)
  })
  if (nameMatches.length >= validSamples.length * 0.6) { // 60% full names
    return 'split:firstName,lastName'
  }
  
  // Check for employee codes - alphanumeric, short, starts with letters
  // Examples: A18, A110, EMP001, ST123, HR01
  const codeMatches = stringSamples.filter(s => {
    return /^[A-Za-z]{1,4}\d{1,5}$/.test(s) || // A18, EMP001
           /^[A-Za-z]{2,5}\d{2,4}[A-Za-z]{0,2}$/.test(s) // HR01, TL12A
  })
  if (codeMatches.length >= validSamples.length * 0.7) {
    return 'employeeCode'
  }
  
  // Check for dates - various formats
  // Excel serial numbers for dates are typically 25000-50000 range
  const dateSerialMatches = validSamples.filter(s => {
    const num = Number(s)
    return !isNaN(num) && num >= 15000 && num <= 55000
  })
  if (dateSerialMatches.length >= validSamples.length * 0.8) {
    return 'dateOfBirth' // Could be DOB or DOJ - pattern alone can't distinguish
  }
  
  // Check for common date string formats
  const dateStringMatches = stringSamples.filter(s => {
    return /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/.test(s) || // DD/MM/YYYY
           /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(s) ||   // YYYY-MM-DD
           /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(s) // 01 Jan 2020
  })
  if (dateStringMatches.length >= validSamples.length * 0.7) {
    return 'dateOfBirth' // Generic date - context determines if DOB/DOJ
  }
  
  // Check for salary values - numbers in typical salary ranges
  const salaryMatches = validSamples.filter(s => {
    const num = parseFloat(String(s).replace(/[₹$,\s]/g, ''))
    return !isNaN(num) && num >= 1000 && num <= 100000000 // 1K to 10Cr range
  })
  if (salaryMatches.length >= validSamples.length * 0.7) {
    // Check if values look like salaries (typically larger numbers)
    const avgValue = salaryMatches.reduce((sum, s) => sum + parseFloat(String(s).replace(/[₹$,\s]/g, '')), 0) / salaryMatches.length
    if (avgValue >= 5000) { // Likely salary if average > 5000
      return 'grossSalary'
    }
  }
  
  return null
}

/**
 * Fallback pattern-based mapping with extensive keyword matching
 * This is designed to be fail-proof with many variations of column names
 */
function patternBasedMapping(headers, sampleRows) {
  const mapping = {}
  const usedFields = new Set() // Track which fields have been mapped
  
  // Extensive keyword lists for each field - ORDERED BY SPECIFICITY (most specific first)
  const fieldKeywords = {
    employeeCode: [
      'employee code', 'emp code', 'emp_code', 'empcode', 'employee_code', 'employeecode',
      'emp id', 'emp_id', 'empid', 'employee id', 'employee_id', 'employeeid',
      'staff code', 'staff_code', 'staffcode', 'staff id', 'staff_id', 'staffid',
      'worker id', 'worker_id', 'workerid', 'id no', 'id_no', 'idno',
      'badge', 'badge no', 'badge_no', 'badgeno', 'code'
    ],
    firstName: [
      'first name', 'first_name', 'firstname', 'given name', 'given_name', 'givenname',
      'f name', 'f_name', 'fname', 'forename'
    ],
    lastName: [
      'last name', 'last_name', 'lastname', 'surname', 'sur name', 'sur_name',
      'family name', 'family_name', 'familyname', 'l name', 'l_name', 'lname'
    ],
    fullName: [ // Will be split to firstName + lastName
      'employee name', 'employee_name', 'employeename', 'emp name', 'emp_name', 'empname',
      'full name', 'full_name', 'fullname', 'staff name', 'staff_name', 'staffname',
      'worker name', 'worker_name', 'workername', 'person name', 'person_name', 'name'
    ],
    email: [
      'official email id', 'official_email_id', 'officialemail',
      'official email', 'official_email', 'email id', 'email_id', 'emailid',
      'email address', 'email_address', 'work email', 'work_email', 'workemail',
      'company email', 'company_email', 'personal email', 'personal_email',
      'e mail', 'e-mail', 'e_mail', 'email', 'mail'
    ],
    phone: [
      'mobile number', 'mobile_number', 'mobilenumber',
      'phone number', 'phone_number', 'phonenumber',
      'contact number', 'contact_number', 'contactnumber',
      'mobile no', 'mobile_no', 'mobileno', 'phone no', 'phone_no', 'phoneno',
      'contact no', 'contact_no', 'contactno',
      'cell phone', 'cell_phone', 'cellphone', 'cell no', 'cell_no', 'cellno',
      'telephone', 'telephone no', 'telephone_no', 'tel no', 'tel_no',
      'mobile', 'phone', 'cell', 'contact', 'tel'
    ],
    gender: [
      'gender', 'sex', 'male female', 'male/female', 'm f', 'm/f'
    ],
    dateOfBirth: [
      'date of birth', 'date_of_birth', 'dateofbirth',
      'birth date', 'birth_date', 'birthdate', 'birthday', 'birth day', 'birth_day',
      'd o b', 'd.o.b', 'd.o.b.', 'dob', 'born', 'born on', 'born_on'
    ],
    dateOfJoining: [
      'date of joining', 'date_of_joining', 'dateofjoining',
      'joining date', 'joining_date', 'joiningdate', 'join date', 'join_date', 'joindate',
      'hire date', 'hire_date', 'hiredate', 'hired on', 'hired_on',
      'start date', 'start_date', 'startdate', 'started on', 'started_on',
      'd o j', 'd.o.j', 'd.o.j.', 'doj', 'joining', 'employment date', 'employment_date'
    ],
    department: [
      'department name', 'department_name', 'departmentname',
      'department', 'dept', 'dept.', 'division', 'unit', 'team', 'section', 'group', 'wing'
    ],
    designation: [
      'designation', 'desig', 'desig.', 'job title', 'job_title', 'jobtitle',
      'title', 'position', 'post', 'role title', 'role_title', 'job role', 'job_role',
      'job position', 'job_position', 'rank'
    ],
    company: [
      'company name', 'company_name', 'companyname', 'organization name', 'organization_name',
      'company', 'organization', 'organisation', 'org', 'org name', 'org_name', 
      'employer', 'firm', 'business', 'entity'
    ],
    employmentType: [
      'employment type', 'employment_type', 'employmenttype', 'employee type', 'employee_type',
      'emp type', 'emp_type', 'emptype', 'job type', 'job_type', 'jobtype',
      'work type', 'work_type', 'worktype', 'contract type', 'contract_type', 'contracttype',
      'ft pt', 'ft/pt', 'full time part time', 'full time/part time'
    ],
    grossSalary: [
      'gross salary', 'gross_salary', 'grosssalary', 'monthly salary', 'monthly_salary',
      'annual salary', 'annual_salary', 'base salary', 'base_salary', 'basic salary', 'basic_salary',
      'cost to company', 'cost_to_company', 'ctc', 'c.t.c', 'c t c',
      'salary', 'gross', 'gross pay', 'gross_pay', 'compensation', 'comp',
      'pay', 'monthly pay', 'monthly_pay', 'wage', 'wages', 'remuneration', 'package', 'income'
    ],
    role: [
      'system role', 'system_role', 'systemrole', 'user role', 'user_role', 'userrole',
      'access role', 'access_role', 'accessrole', 'permission', 'access level', 'access_level',
      'admin user', 'admin/user', 'account type', 'account_type'
    ],
    level: [
      'employee level', 'employee_level', 'employeelevel', 'emp level', 'emp_level', 'emplevel',
      'designation level', 'designation_level', 'job level', 'job_level', 'joblevel',
      'grade', 'band', 'tier'
    ]
  }
  
  // Columns to completely skip - never map these
  // IMPORTANT: Be specific to avoid false positives (e.g., "number" would skip "Mobile Number")
  const skipPatterns = [
    's no', 's.no', 'sno', 'serial', 'sr', 'sr.', 'sr no', 'sl', 'sl.', 'sl no',
    '#', 'row', 'index', 'no.', 
    'father', 'father name', 'fathers name', 'mother', 'mother name', 'mothers name',
    'spouse', 'spouse name', 'guardian', 'emergency contact', 'reference',
    'address', 'permanent address', 'current address', 'residential address',
    'pincode', 'pin code', 'zip', 'zip code', 'postal',
    'state', 'country', 'city', 'district', 'locality', 'location',
    'blood', 'blood group', 'blood type',
    'pan', 'pan no', 'pan number', 'pan card',
    'aadhaar', 'aadhar', 'aadhaar no', 'aadhar no', 'aadhaar number', 'aadhar number', 'uid',
    'passport', 'passport no',
    'bank', 'bank name', 'account', 'account no', 'account number', 'ifsc', 'branch',
    'shift', 'shift name', 'shift timing',
    'reporting', 'reporting to', 'reports to', 'manager name', 'supervisor',
    'marital', 'marital status', 'employee status', 'status'
  ]
  
  // Fields that should NEVER be skipped even if they partially match skip patterns
  const neverSkipFields = ['mobile number', 'phone number', 'contact number', 'mobile', 'phone', 'employee type', 'employment type', 'employee level', 'emp level', 'level', 'designation level', 'grade', 'band']
  
  // Normalize header for comparison - handle special characters
  const normalizeHeader = (h) => {
    if (!h) return ''
    return String(h).toLowerCase().trim()
      .replace(/[_\-\.\/\\]/g, ' ')  // Replace separators with spaces
      .replace(/\s+/g, ' ')          // Collapse multiple spaces
      .trim()
  }
  
  // Check if header should be skipped
  const shouldSkip = (normalizedHeader) => {
    // NEVER skip phone/mobile related fields
    if (neverSkipFields.some(field => normalizedHeader.includes(field) || field.includes(normalizedHeader))) {
      return false
    }
    
    // Exact match or starts/ends with skip pattern
    return skipPatterns.some(skip => {
      const normalizedSkip = normalizeHeader(skip)
      return normalizedHeader === normalizedSkip ||
             normalizedHeader.startsWith(normalizedSkip + ' ') ||
             normalizedHeader.endsWith(' ' + normalizedSkip) ||
             (normalizedSkip.length > 3 && normalizedHeader.includes(normalizedSkip))
    })
  }
  
  console.log('[PatternMapping] Starting header analysis...')
  
  // First pass: exact and keyword matching on headers
  headers.forEach((header, idx) => {
    const samples = sampleRows.slice(0, 10).map(row => row[idx]).filter(v => v !== undefined && v !== null && v !== '')
    const normalizedHeader = normalizeHeader(header)
    
    console.log(`[PatternMapping] Column ${idx}: "${header}" → normalized: "${normalizedHeader}"`)
    
    // Skip columns with headers that are clearly not relevant
    if (shouldSkip(normalizedHeader)) {
      console.log(`[PatternMapping]   → SKIPPED (matches skip pattern)`)
      mapping[idx] = 'null'
      return
    }
    
    // If no header but has samples, try to detect from samples
    if (!header || header === '') {
      const detected = detectFieldFromSamples(samples)
      if (detected && !usedFields.has(detected.replace('split:', ''))) {
        console.log(`[PatternMapping]   → Detected from samples: ${detected}`)
        mapping[idx] = detected
        usedFields.add(detected.replace('split:', '').split(',')[0])
      } else {
        mapping[idx] = 'null'
      }
      return
    }
    
    // Try to match each field's keywords
    let matched = false
    for (const [field, keywords] of Object.entries(fieldKeywords)) {
      if (usedFields.has(field)) continue // Skip if field already mapped
      if (field === 'fullName' && (usedFields.has('firstName') || usedFields.has('lastName'))) continue
      
      // Check if header matches any keyword
      for (const keyword of keywords) {
        const normalizedKeyword = normalizeHeader(keyword)
        
        // Exact match has highest priority
        if (normalizedHeader === normalizedKeyword) {
          if (field === 'fullName') {
            console.log(`[PatternMapping]   → EXACT MATCH: split:firstName,lastName`)
            mapping[idx] = 'split:firstName,lastName'
            usedFields.add('firstName')
            usedFields.add('lastName')
          } else {
            console.log(`[PatternMapping]   → EXACT MATCH: ${field}`)
            mapping[idx] = field
            usedFields.add(field)
          }
          matched = true
          break
        }
        
        // Partial match - header contains keyword or vice versa
        if (normalizedHeader.includes(normalizedKeyword) || 
            (normalizedKeyword.length > 4 && normalizedKeyword.includes(normalizedHeader))) {
          if (field === 'fullName') {
            console.log(`[PatternMapping]   → PARTIAL MATCH: split:firstName,lastName (keyword: "${keyword}")`)
            mapping[idx] = 'split:firstName,lastName'
            usedFields.add('firstName')
            usedFields.add('lastName')
          } else {
            console.log(`[PatternMapping]   → PARTIAL MATCH: ${field} (keyword: "${keyword}")`)
            mapping[idx] = field
            usedFields.add(field)
          }
          matched = true
          break
        }
      }
      if (matched) break
    }
    
    // If still not matched, try sample-based detection
    if (!matched) {
      const detected = detectFieldFromSamples(samples)
      if (detected && !usedFields.has(detected.replace('split:', '').split(',')[0])) {
        console.log(`[PatternMapping]   → DETECTED FROM SAMPLES: ${detected}`)
        mapping[idx] = detected
        usedFields.add(detected.replace('split:', '').split(',')[0])
        matched = true
      }
    }
    
    // If still not matched, mark as null
    if (!matched) {
      console.log(`[PatternMapping]   → NO MATCH`)
      mapping[idx] = 'null'
    }
  })
  
  // Second pass: validate detected fields with sample data
  for (const [colIdx, field] of Object.entries(mapping)) {
    if (field === 'null') continue
    
    const idx = parseInt(colIdx)
    const samples = sampleRows.slice(0, 5).map(row => row[idx]).filter(v => v !== undefined && v !== null && v !== '')
    
    // Validate email field
    if (field === 'email') {
      const hasValidEmails = samples.some(s => String(s).includes('@') && String(s).includes('.'))
      if (!hasValidEmails && samples.length > 0) {
        // This might not be email, check if it's something else
        console.log(`[PatternMapping] Validating email column ${idx} - samples:`, samples.slice(0,3))
        const detected = detectFieldFromSamples(samples)
        if (detected && detected !== 'email') {
          console.log(`[PatternMapping]   → Changing ${field} to ${detected}`)
          mapping[colIdx] = detected
        }
      }
    }
    
    // Validate phone field  
    if (field === 'phone') {
      const hasValidPhones = samples.some(s => /\d{10,}/.test(String(s).replace(/[\s\-()]/g, '')))
      if (!hasValidPhones && samples.length > 0) {
        console.log(`[PatternMapping] Phone validation failed for column ${idx} - changing to null`)
        mapping[colIdx] = 'null'
      }
    }
  }
  
  console.log('[PatternMapping] Final mapping:', JSON.stringify(mapping))
  return mapping
}

/**
 * Transform a row using the column mapping
 */
function transformRow(row, mapping) {
  const result = {}
  
  // Initialize all fields as empty
  TEMPLATE_FIELDS.forEach(f => {
    result[f.key] = ''
  })
  
  for (const [colIdx, fieldMapping] of Object.entries(mapping)) {
    // Skip null, undefined, or 'null' string mappings
    if (!fieldMapping || fieldMapping === 'null') continue
    
    const idx = parseInt(colIdx)
    const value = row[idx]
    
    if (value === undefined || value === null || value === '') continue
    
    // Handle split fields (like fullName -> firstName, lastName)
    if (typeof fieldMapping === 'string' && fieldMapping.startsWith('split:')) {
      const fields = fieldMapping.replace('split:', '').split(',')
      const nameParts = String(value).trim().split(/\s+/)
      if (fields.length >= 2 && nameParts.length >= 1) {
        result[fields[0]] = nameParts[0] || ''
        result[fields[1]] = nameParts.slice(1).join(' ') || ''
      }
      continue
    }
    
    // Handle date fields
    if (fieldMapping === 'dateOfBirth' || fieldMapping === 'dateOfJoining') {
      result[fieldMapping] = formatValue(value, fieldMapping)
      continue
    }
    
    // Handle gender normalization
    if (fieldMapping === 'gender') {
      const v = String(value).toLowerCase()
      if (v === 'm' || v === 'male') {
        result[fieldMapping] = 'Male'
      } else if (v === 'f' || v === 'female') {
        result[fieldMapping] = 'Female'
      } else {
        result[fieldMapping] = 'Other'
      }
      continue
    }
    
    // Handle role normalization - only allow hr, manager, employee (not admin)
    if (fieldMapping === 'role') {
      const v = String(value).toLowerCase().trim()
      if (['hr', 'manager', 'employee'].includes(v)) {
        result[fieldMapping] = v // Store lowercase to match DB schema
      } else {
        // Will be detected from designation later
        result[fieldMapping] = ''
      }
      continue
    }
    
    // Handle grossSalary - format as number
    if (fieldMapping === 'grossSalary') {
      const num = parseFloat(value)
      if (!isNaN(num) && num > 0) {
        result[fieldMapping] = `₹${num.toLocaleString('en-IN')}`
      } else {
        result[fieldMapping] = String(value).trim()
      }
      continue
    }
    
    // Handle level - normalize to level name
    if (fieldMapping === 'level') {
      const parsed = parseLevelFromValue(value)
      if (parsed) {
        result.level = parsed.levelName
        result._levelNumber = parsed.level // Store number for DB
      } else {
        result.level = String(value).trim()
      }
      continue
    }
    
    result[fieldMapping] = String(value).trim()
  }
  
  // Detect role from designation if not explicitly set
  if (!result.role || result.role === '') {
    result.role = detectUserRoleFromDesignation(result.designation, result.department)
  }
  
  // Detect level from designation if not explicitly set
  if (!result.level || result.level === '') {
    const detectedLevel = detectLevelFromDesignation(result.designation)
    result.level = detectedLevel.levelName
    result._levelNumber = detectedLevel.level
  }
  
  return result
}

/**
 * Detect which row contains the actual headers
 * Some Excel files have title rows, merged cells, or metadata before the header row
 * Returns the index of the header row (0-based)
 */
function findHeaderRow(rawData) {
  // Common header keywords that indicate an employee data header row
  const headerKeywords = [
    'employee', 'emp', 'name', 'email', 'phone', 'mobile', 'gender', 'department', 
    'designation', 'dob', 'doj', 'date', 'salary', 'code', 'id', 'first', 'last',
    'contact', 'joining', 'birth', 'company', 'type', 'status'
  ]
  
  // Check first 5 rows to find the header row
  for (let i = 0; i < Math.min(5, rawData.length); i++) {
    const row = rawData[i]
    if (!row || !Array.isArray(row)) continue
    
    // Count how many cells in this row match header keywords
    let headerMatches = 0
    let nonEmptyCells = 0
    
    for (const cell of row) {
      if (cell === undefined || cell === null || cell === '') continue
      nonEmptyCells++
      
      const cellStr = String(cell).toLowerCase().trim()
      // Check if this cell contains any header keyword
      if (headerKeywords.some(keyword => cellStr.includes(keyword))) {
        headerMatches++
      }
    }
    
    // If this row has at least 3 header-like cells and multiple non-empty cells, it's likely the header
    if (headerMatches >= 3 && nonEmptyCells >= 5) {
      console.log(`[HeaderDetection] Found header row at index ${i} (${headerMatches} header matches, ${nonEmptyCells} cells)`)
      return i
    }
  }
  
  // Default to row 0 if no clear header row found
  console.log('[HeaderDetection] No clear header row found, defaulting to row 0')
  return 0
}

/**
 * POST - Preview bulk import with AI mapping
 */
export async function POST(request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    
    if (!file) {
      return NextResponse.json({ success: false, message: 'No file uploaded' }, { status: 400 })
    }

    const fileName = file.name || ''
    if (!fileName.match(/\.(xlsx|xls)$/i)) {
      return NextResponse.json({ success: false, message: 'Invalid file format' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true })
    
    if (rawData.length < 2) {
      return NextResponse.json({ success: false, message: 'Excel file is empty' }, { status: 400 })
    }

    // Smart header detection - find the actual header row
    const headerRowIndex = findHeaderRow(rawData)
    
    // Clean up headers - trim whitespace and normalize
    const headers = (rawData[headerRowIndex] || []).map(h => h !== undefined && h !== null ? String(h).trim() : '')
    const dataRows = rawData.slice(headerRowIndex + 1).filter(row => 
      row && row.some(cell => cell !== undefined && cell !== null && cell !== '')
    )

    if (dataRows.length === 0) {
      return NextResponse.json({ success: false, message: 'No data rows found' }, { status: 400 })
    }

    console.log('[Preview] ═══════════════════════════════════════')
    console.log(`[Preview] Header row index: ${headerRowIndex}`)
    console.log('[Preview] Headers detected:', JSON.stringify(headers))
    console.log('[Preview] Total data rows:', dataRows.length)
    console.log('[Preview] First row sample:', JSON.stringify(dataRows[0]))

    // STEP 1: Try pattern-based mapping FIRST - it's deterministic and reliable
    console.log('[Preview] STEP 1: Trying pattern-based mapping...')
    let columnMapping = patternBasedMapping(headers, dataRows)
    let mappingMethod = 'pattern'
    
    // Check if pattern mapping found the essentials
    const patternMappedFields = Object.values(columnMapping).filter(v => v && v !== 'null')
    const hasEmail = patternMappedFields.includes('email')
    const hasName = patternMappedFields.includes('firstName') || 
                   patternMappedFields.includes('split:firstName,lastName')
    
    console.log(`[Preview] Pattern mapping found ${patternMappedFields.length} fields:`, patternMappedFields)
    console.log(`[Preview] Has email: ${hasEmail}, Has name: ${hasName}`)

    // STEP 2: If pattern mapping missed essentials, try AI enhancement
    if (!hasEmail || !hasName) {
      console.log('[Preview] STEP 2: Pattern incomplete, trying AI enhancement...')
      const aiMapping = await aiMapColumns(headers, dataRows)
      
      if (aiMapping) {
        console.log('[Preview] AI mapping result:', JSON.stringify(aiMapping))
        
        // Merge AI results - AI takes precedence for unmapped fields
        for (const [colIdx, field] of Object.entries(aiMapping)) {
          if (field && field !== 'null' && (!columnMapping[colIdx] || columnMapping[colIdx] === 'null')) {
            columnMapping[colIdx] = field
          }
        }
        mappingMethod = 'pattern+ai'
      } else {
        console.log('[Preview] AI mapping returned null, using pattern only')
      }
    }
    
    console.log(`[Preview] Final mapping (${mappingMethod}):`, JSON.stringify(columnMapping))

    // Transform all rows to our template format
    const transformedRows = dataRows.map(row => transformRow(row, columnMapping))

    // Build column mapping display info
    const detectedMappings = []
    for (const [colIdx, field] of Object.entries(columnMapping)) {
      if (field !== 'null') {
        const header = headers[parseInt(colIdx)] || `Column ${parseInt(colIdx) + 1}`
        detectedMappings.push({
          sourceColumn: header,
          targetField: field.startsWith('split:') ? field.replace('split:', '').split(',').join(' & ') : field,
          columnIndex: parseInt(colIdx)
        })
      }
    }

    // Check for required fields in transformed data
    const hasValidEmails = transformedRows.some(row => row.email && row.email.includes('@'))
    const warnings = []
    
    if (!hasValidEmails) {
      warnings.push('No valid email addresses detected. Email is required for each employee.')
    }

    // Validate each row
    const rowWarnings = transformedRows.map((row, idx) => {
      const issues = []
      if (!row.email || !row.email.includes('@')) {
        issues.push('Missing or invalid email')
      }
      if (!row.firstName && !row.lastName) {
        issues.push('No name detected')
      }
      return issues.length > 0 ? { rowNumber: idx + 2, issues } : null
    }).filter(Boolean)

    return NextResponse.json({
      success: true,
      data: {
        templateFields: TEMPLATE_FIELDS,
        transformedRows,
        totalRows: transformedRows.length,
        detectedMappings,
        mappingMethod,
        originalHeaders: headers,
        warnings,
        rowWarnings,
      }
    })

  } catch (error) {
    console.error('[Preview Error]:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to process file' },
      { status: 500 }
    )
  }
}
