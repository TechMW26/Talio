import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import queryCache from '@/lib/queryCache'
import { createWorkbookBuffer, readFirstWorksheetRows } from '@/lib/spreadsheets.server'
import { clearCachePattern, buildCachePattern } from '@/lib/cache'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'
import { BULK_IMPORT_STORE_OPTIONS, createOrUpdateEmployeeAndUser, findHeaderRow, getColumnMapping, parseRowWithMapping } from '@/lib/employeeBulkImport.server'

export const dynamic = 'force-dynamic'

/**
 * POST - Bulk import employees from Excel file
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndDatabase(request, BULK_IMPORT_STORE_OPTIONS)
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { database } = auth
    if (!['admin', 'hr'].includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Only administrators and HR can import employees' }, { status: 403 })

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
    if (!fileName.match(/\.xlsx$/i)) {
      return NextResponse.json(
        { success: false, message: 'Invalid file format. Please upload an Excel workbook (.xlsx)' },
        { status: 400 }
      )
    }

    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ success: false, message: 'Workbook must be smaller than 10 MB' }, { status: 413 })

    // Read file content
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Parse Excel file
    const rawData = await readFirstWorksheetRows(buffer)

    if (rawData.length > 2001) return NextResponse.json({ success: false, message: 'Import at most 2000 rows per workbook' }, { status: 413 })
    if (rawData.length < 2) {
      return NextResponse.json(
        { success: false, message: 'Excel file is empty or has no data rows' },
        { status: 400 }
      )
    }

    // Smart header detection - find the actual header row
    const headerRowIndex = findHeaderRow(rawData)
    console.log(`[Bulk Import] Detected header row at index: ${headerRowIndex}`)

    const headers = rawData[headerRowIndex]
    const dataRows = rawData.slice(headerRowIndex + 1).filter(row => row.some(cell => cell !== undefined && cell !== null && cell !== ''))

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
      collectFirestorePages(database, 'departments'),
      collectFirestorePages(database, 'designations'),
      collectFirestorePages(database, 'companies')
    ])

    // Create mutable arrays for dynamic creation
    const allDepartments = [...departments]
    const allDesignations = [...designations]
    const allCompanies = [...companies]

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
      skipped: 0,
      departmentsCreated: 0,
      designationsCreated: 0,
      companiesCreated: 0,
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
        let employeeData = parseRowWithMapping(row, columnMapping)

        // Skip completely empty rows
        if (!employeeData.email && !employeeData.employeeCode && !employeeData.firstName) {
          continue
        }

        // Skip employees with non-active status (terminated, resigned, etc.)
        if (employeeData.status === 'inactive-skip') {
          results.skipped++
          results.warnings.push(`Row ${rowNumber}: Skipped - Employee status is terminated/resigned/inactive`)
          continue
        }

        // NOTE: AI spell-check removed for performance - imports are now instant
        // Departments, designations, and companies use fuzzy matching instead

        const result = await createOrUpdateEmployeeAndUser(
          employeeData,
          allDepartments,
          allDesignations,
          allCompanies,
          companyMap,
          database,
          auth
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
          if (result.companyCreated) results.companiesCreated++

        } else {
          results.failed.push({
            rowNumber,
            employeeCode: employeeData.employeeCode || 'N/A',
            name: employeeData.firstName ? `${employeeData.firstName} ${employeeData.lastName || ''}`.trim() : 'N/A',
            errors: result.errors,
          })
        }
      } catch (error) {
        console.error(`[Bulk Import] Row ${rowNumber} failed`, error.code || error.status || 'validation')
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
    await Promise.all(['employees:list', 'directory:list'].map(namespace => clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace })).catch(() => {})))

    // Build summary message
    const summaryParts = []
    if (results.created.length > 0) summaryParts.push(`${results.created.length} created`)
    if (results.updated.length > 0) summaryParts.push(`${results.updated.length} updated`)
    if (results.failed.length > 0) summaryParts.push(`${results.failed.length} failed`)
    if (results.departmentsCreated > 0) summaryParts.push(`${results.departmentsCreated} new departments`)
    if (results.designationsCreated > 0) summaryParts.push(`${results.designationsCreated} new designations`)
    if (results.companiesCreated > 0) summaryParts.push(`${results.companiesCreated} new companies`)

    return NextResponse.json({
      success: true,
      message: `Bulk import completed: ${summaryParts.join(', ')}`,
      data: results,
    })

  } catch (error) {
    console.error('Bulk import error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to process bulk import' },
      { status: error.status || 500 }
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
        'Gross Salary',
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
        '50000',
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
        '75000',
        'Acme Corp',
        'password456',
      ],
      [
        'EMP003',
        'Rahul',
        'Kumar',
        'rahul.kumar@example.com',
        '+919876543210',
        'Male',
        '1988-08-10',
        '2023-06-01',
        'Sales',
        'Sales Executive',
        'employee',
        'full-time',
        'active',
        '35000',
        'Tech Solutions',
        'password789',
      ],
    ]

    const buffer = await createWorkbookBuffer([{ name: 'Employees', rows: sampleData, widths: [15, 15, 15, 28, 15, 10, 15, 15, 15, 20, 12, 15, 10, 15, 18, 15] }])

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
