import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { generateContent } from '@/lib/gemini'

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

    const targetFieldsList = TEMPLATE_FIELDS.map(f => `- ${f.key}: ${f.description}`).join('\n')

    const prompt = `Analyze this Excel data and map columns to employee fields.

COLUMNS IN UPLOADED FILE:
${columnSamples.map(c => `[${c.index}] "${c.header}" = [${c.samples.map(s => `"${s}"`).join(', ')}]`).join('\n')}

MAP TO THESE FIELDS (use "null" if no match):
${targetFieldsList}

RULES:
1. "Name" or "Employee Name" with full names like "John Smith" → use BOTH firstName AND lastName (split the name)
2. Email columns contain @ symbols
3. Numbers 25000-73050 are likely Excel dates (days since 1900)
4. Numbers 10000-99999 might be employee codes
5. 10-digit numbers are phone numbers
6. M/F/Male/Female → gender
7. Department names like "HR", "IT", "Sales", "Engineering"
8. Designations like "Manager", "Developer", "Executive", "Analyst"
9. Serial/S.No/# columns should be ignored
10. Large numbers like 15000, 50000, 100000 with headers like "Salary", "CTC", "Compensation", "Gross" → grossSalary

Return JSON mapping column index to field (or "split:firstName,lastName" for name columns):
Example: {"0": "null", "1": "split:firstName,lastName", "2": "email", "3": "department", "4": "dateOfJoining"}

JSON only:`

    const response = await generateContent(prompt, 'Return only valid JSON, no explanation.')
    
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (error) {
    console.error('[AI Column Mapping Error]:', error.message)
  }
  return null
}

/**
 * Fallback pattern-based mapping
 */
function patternBasedMapping(headers, sampleRows) {
  const mapping = {}
  
  headers.forEach((header, idx) => {
    if (!header) {
      // Check samples
      const samples = sampleRows.slice(0, 5).map(row => row[idx]).filter(v => v)
      if (samples.every(s => String(s).includes('@'))) {
        mapping[idx] = 'email'
        return
      }
      mapping[idx] = 'null'
      return
    }
    
    const h = header.toString().toLowerCase().trim()
    
    // Check for name fields
    if (/^(name|employee[\s_-]*name|full[\s_-]*name)$/i.test(h)) {
      mapping[idx] = 'split:firstName,lastName'
    } else if (/first|given/i.test(h) && /name/i.test(h)) {
      mapping[idx] = 'firstName'
    } else if (/last|sur|family/i.test(h) && /name/i.test(h)) {
      mapping[idx] = 'lastName'
    } else if (/e[\s_-]*mail|email/i.test(h)) {
      mapping[idx] = 'email'
    } else if (/phone|mobile|cell|contact/i.test(h)) {
      mapping[idx] = 'phone'
    } else if (/d\.?o\.?b|birth/i.test(h)) {
      mapping[idx] = 'dateOfBirth'
    } else if (/d\.?o\.?j|join|hire|start/i.test(h)) {
      mapping[idx] = 'dateOfJoining'
    } else if (/gender|sex/i.test(h)) {
      mapping[idx] = 'gender'
    } else if (/dept|department/i.test(h)) {
      mapping[idx] = 'department'
    } else if (/company|org|organization|firm|employer/i.test(h)) {
      mapping[idx] = 'company'
    } else if (/design|title|position|post/i.test(h)) {
      mapping[idx] = 'designation'
    } else if (/^role$|system.*role|user.*role|access.*role/i.test(h)) {
      mapping[idx] = 'role'
    } else if (/emp.*code|emp.*id|staff.*id|employee.*id|code|id/i.test(h)) {
      mapping[idx] = 'employeeCode'
    } else if (/type|employment/i.test(h)) {
      mapping[idx] = 'employmentType'
    } else if (/salary|ctc|compensation|pay|gross|wage/i.test(h)) {
      mapping[idx] = 'grossSalary'
    } else {
      mapping[idx] = 'null'
    }
  })
  
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
    
    result[fieldMapping] = String(value).trim()
  }
  
  // Detect role from designation if not explicitly set
  if (!result.role || result.role === '') {
    result.role = detectUserRoleFromDesignation(result.designation, result.department)
  }
  
  return result
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

    const headers = rawData[0] || []
    const dataRows = rawData.slice(1).filter(row => 
      row && row.some(cell => cell !== undefined && cell !== null && cell !== '')
    )

    if (dataRows.length === 0) {
      return NextResponse.json({ success: false, message: 'No data rows found' }, { status: 400 })
    }

    // Get column mapping (AI first, then pattern-based)
    console.log('[Preview] Analyzing Excel structure...')
    let columnMapping = await aiMapColumns(headers, dataRows)
    let mappingMethod = 'ai'
    
    if (!columnMapping) {
      columnMapping = patternBasedMapping(headers, dataRows)
      mappingMethod = 'pattern'
    }
    
    console.log(`[Preview] Mapping (${mappingMethod}):`, columnMapping)

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

    // Check for required fields
    const hasEmail = transformedRows.some(row => row.email && row.email.includes('@'))
    const warnings = []
    
    if (!hasEmail) {
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
