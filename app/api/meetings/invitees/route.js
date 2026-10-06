import { getMeetingDatabase, meetingFilter } from '@/lib/meetings/store.server'
import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
export const dynamic = 'force-dynamic'

// GET - Get employees grouped by department for meeting invitations
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const database = await getMeetingDatabase(auth.tenant.databaseName)

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''

    // Get all active departments
    const departments = (await collectFirestorePages(database, 'departments')).filter(row => row.isActive !== false).sort((a,b) => String(a.name).localeCompare(String(b.name)))
    const filters = [meetingFilter('status', ['active', 'probation', 'on_leave'], 'in')]
    if (search.trim()) filters.push(meetingFilter('searchGrams', search.trim().toLowerCase().slice(0, 3), 'array-contains'))
    let rows = await collectFirestorePages(database, 'employees', { filters })
    if (search.trim()) rows = rows.filter(row => [row.firstName, row.lastName, row.email].some(value => String(value || '').toLowerCase().includes(search.trim().toLowerCase())))
    const departmentsById = new Map(departments.map(row => [row._id, { _id: row._id, name: row.name, code: row.code }]))
    const designations = await readFirestoreReferences(database, 'designations', rows.map(row => row.designation).filter(Boolean))
    const employees = rows.map(row => ({ ...row, department: departmentsById.get(String(row.department)), departments: (row.departments || []).map(id => departmentsById.get(String(id))).filter(Boolean), designation: designations.get(String(row.designation)) })).sort((a,b) => String(a.firstName).localeCompare(String(b.firstName)) || String(a.lastName).localeCompare(String(b.lastName)))

    // Group employees by department
    const departmentGroups = []

    for (const dept of departments) {
      const deptEmployees = employees.filter(emp => {
        // Check both single department and multiple departments
        const inSingleDept = emp.department?._id?.toString() === dept._id.toString()
        const inMultipleDepts = emp.departments?.some(d => d._id?.toString() === dept._id.toString())
        return inSingleDept || inMultipleDepts
      })

      if (deptEmployees.length > 0) {
        departmentGroups.push({
          department: {
            _id: dept._id,
            name: dept.name,
            code: dept.code
          },
          employees: deptEmployees.map(emp => ({
            _id: emp._id,
            firstName: emp.firstName,
            lastName: emp.lastName,
            fullName: `${emp.firstName} ${emp.lastName}`,
            email: emp.email,
            profilePicture: emp.profilePicture,
            designation: emp.designation?.title || 'Employee'
          })),
          count: deptEmployees.length
        })
      }
    }

    // Add employees without department
    const noDeptEmployees = employees.filter(emp => 
      !emp.department && (!emp.departments || emp.departments.length === 0)
    )

    if (noDeptEmployees.length > 0) {
      departmentGroups.push({
        department: {
          _id: 'no-department',
          name: 'No Department',
          code: 'NONE'
        },
        employees: noDeptEmployees.map(emp => ({
          _id: emp._id,
          firstName: emp.firstName,
          lastName: emp.lastName,
          fullName: `${emp.firstName} ${emp.lastName}`,
          email: emp.email,
          profilePicture: emp.profilePicture,
          designation: emp.designation?.title || 'Employee'
        })),
        count: noDeptEmployees.length
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        departmentGroups,
        totalEmployees: employees.length,
        totalDepartments: departmentGroups.length
      }
    })
  } catch (error) {
    console.error('Get department employees error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
