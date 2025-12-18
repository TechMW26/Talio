import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import Employee from '@/models/Employee'
import User from '@/models/User'
import Department from '@/models/Department'
import Designation from '@/models/Designation'
import Company from '@/models/Company'
import queryCache from '@/lib/queryCache'
import * as XLSX from 'xlsx'

// Ensure models are registered
const _ensureModels = { Department, Designation, Company }

/**
 * Helper function to create a single employee and user account
 * This mirrors the exact logic used in the single employee creation (POST /api/employees)
 */
async function createEmployeeAndUser(data, departmentMap, designationMap, companyMap) {
  const errors = []
  
  // Validate required fields
  if (!data.employeeCode) errors.push('Employee Code is required')
  if (!data.firstName) errors.push('First Name is required')
  if (!data.lastName) errors.push('Last Name is required')
  if (!data.email) errors.push('Email is required')
  if (!data.phone) errors.push('Phone is required')
  if (!data.dateOfJoining) errors.push('Date of Joining is required')
  
  if (errors.length > 0) {
    return { success: false, errors }
  }

  // Check for existing employee/user
  const [existingEmployee, existingEmail, existingUser] = await Promise.all([
    Employee.findOne({ employeeCode: data.employeeCode }).lean(),
    Employee.findOne({ email: data.email.toLowerCase() }).lean(),
    User.findOne({ email: data.email.toLowerCase() }).lean()
  ])

  if (existingEmployee) {
    return { success: false, errors: [`Employee code '${data.employeeCode}' already exists`] }
  }
  if (existingEmail) {
    return { success: false, errors: [`Email '${data.email}' already exists in employees`] }
  }
  if (existingUser) {
    return { success: false, errors: [`User account with email '${data.email}' already exists`] }
  }

  // Prepare employee data - same logic as single employee creation
  const employeeData = { ...data }
  
  // Map department name to ID if provided as string
  if (employeeData.department && typeof employeeData.department === 'string') {
    const deptId = departmentMap.get(employeeData.department.toLowerCase().trim())
    if (deptId) {
      employeeData.department = deptId
      employeeData.departments = [deptId]
    } else {
      employeeData.department = undefined
      employeeData.departments = []
    }
  }
  
  // Map designation name to ID if provided as string
  if (employeeData.designation && typeof employeeData.designation === 'string') {
    const desigId = designationMap.get(employeeData.designation.toLowerCase().trim())
    if (desigId) {
      employeeData.designation = desigId
    } else {
      employeeData.designation = undefined
    }
  }
  
  // Map company name to ID if provided as string
  if (employeeData.company && typeof employeeData.company === 'string') {
    const compId = companyMap.get(employeeData.company.toLowerCase().trim())
    if (compId) {
      employeeData.company = compId
    } else {
      employeeData.company = undefined
    }
  }

  // Sanitize ObjectId fields - convert empty strings to null/undefined
  const objectIdFields = ['company', 'department', 'designation', 'reportingManager']
  objectIdFields.forEach(field => {
    if (employeeData[field] === '' || employeeData[field] === null) {
      employeeData[field] = undefined
    }
  })

  // Handle designation level
  if (employeeData.designationLevel) {
    employeeData.designationLevel = parseInt(employeeData.designationLevel) || 1
  }

  // Ensure email is lowercase
  employeeData.email = employeeData.email.toLowerCase().trim()

  // Create employee first
  const employee = await Employee.create(employeeData)

  // Create user account for the employee - exactly like single employee creation
  const password = data.password || 'employee123' // Default password if not provided

  const userData = {
    email: data.email.toLowerCase().trim(),
    password: password, // Let the pre-save hook handle hashing
    role: data.role || 'employee', // Default role is employee
    employeeId: employee._id,
    forcePasswordChange: true, // Force password change on first login
  }

  // Add company to user if provided (same company as employee)
  if (employeeData.company) {
    userData.company = employeeData.company
  }

  const user = await User.create(userData)

  // Update employee with userId reference
  await Employee.findByIdAndUpdate(employee._id, { userId: user._id })

  return {
    success: true,
    employee: {
      _id: employee._id,
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
    },
    credentials: {
      email: data.email,
      password: password,
    }
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

    // Parse dates
    if (fieldName === 'dateOfBirth' || fieldName === 'dateOfJoining') {
      if (typeof value === 'number') {
        // Excel date serial number
        const date = XLSX.SSF.parse_date_code(value)
        if (date) {
          value = new Date(date.y, date.m - 1, date.d)
        }
      } else if (typeof value === 'string') {
        // Try to parse string date
        const parsed = new Date(value)
        if (!isNaN(parsed.getTime())) {
          value = parsed
        }
      }
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

    // Fetch departments, designations, and companies for mapping
    const [departments, designations, companies] = await Promise.all([
      Department.find({}).select('_id name code').lean(),
      Designation.find({}).select('_id title').lean(),
      Company.find({}).select('_id name code').lean()
    ])

    // Create lookup maps (case-insensitive)
    const departmentMap = new Map()
    departments.forEach(dept => {
      departmentMap.set(dept.name.toLowerCase(), dept._id)
      if (dept.code) {
        departmentMap.set(dept.code.toLowerCase(), dept._id)
      }
    })

    const designationMap = new Map()
    designations.forEach(desig => {
      designationMap.set(desig.title.toLowerCase(), desig._id)
    })

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
      successful: [],
      failed: [],
    }

    for (let i = 0; i < dataRows.length; i++) {
      const rowNumber = i + 2 // Account for header row and 1-based indexing
      const row = dataRows[i]
      
      try {
        const employeeData = parseExcelRow(row, headers)
        
        // Skip empty rows
        if (!employeeData.employeeCode && !employeeData.email && !employeeData.firstName) {
          continue
        }

        const result = await createEmployeeAndUser(
          employeeData,
          departmentMap,
          designationMap,
          companyMap
        )

        if (result.success) {
          results.successful.push({
            rowNumber,
            employeeCode: result.employee.employeeCode,
            name: `${result.employee.firstName} ${result.employee.lastName}`,
            email: result.employee.email,
            credentials: result.credentials,
          })
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

    // Clear employee list cache
    queryCache.clearPattern('employees')

    return NextResponse.json({
      success: true,
      message: `Bulk import completed. ${results.successful.length} of ${results.total} employees created successfully.`,
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
