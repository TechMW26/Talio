import { NextResponse } from 'next/server'
import { verifySuperAdmin } from '@/lib/superadminAuth'
import { getSuperadminStore, newRecordId, readReportPages } from '@/lib/platform/firestoreSuperadmin.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { provisionFirestoreAccount, updateFirestoreAdminAccount } from '@/lib/platform/firestoreProvisioning.server'
import { clearTenantCache } from '@/lib/tenantContext'

const failure = error => NextResponse.json({ success: false, message: error.status ? error.message : 'Admin operation failed' }, { status: error.status || 500 })
const employeeView = employee => employee ? { firstName: employee.firstName, lastName: employee.lastName, employeeId: employee.employeeCode || employee.employeeId } : null

export async function GET(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const { id } = await params
    const company = await (await getSuperadminStore()).get('tenantcompanies', id)
    if (!company) return NextResponse.json({ success: false, message: 'Company not found' }, { status: 404 })
    const database = await getFirestoreTenantDatabase(company.databaseName, { queryFields: { users: ['role'] } })
    const users = await readReportPages(database, 'users', { filters: [{ field: 'role', operator: '==', value: 'admin' }] })
    const admins = []
    for (let offset = 0; offset < users.length; offset += 20) {
      admins.push(...await Promise.all(users.slice(offset, offset + 20).map(async user => ({
        _id: user._id, email: user.email, role: user.role, isActive: user.isActive,
        forcePasswordChange: user.forcePasswordChange, lastLogin: user.lastLogin, createdAt: user.createdAt,
        employee: employeeView(user.employeeId ? await database.get('employees', String(user.employeeId)) : null),
      }))))
    }
    return NextResponse.json({ success: true, admins, companyName: company.name, databaseName: company.databaseName })
  } catch (error) { return failure(error) }
}

export async function POST(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const { id } = await params
    const body = await request.json()
    const result = await provisionFirestoreAccount({
      email: body.email, password: body.password,
      employeeData: { firstName: body.firstName, lastName: body.lastName || '', phone: body.phone || '', employeeCode: 'ADMIN-' + newRecordId().slice(0, 10).toUpperCase() },
    }, { superadmin: { _id: auth.superadmin._id, companyId: id } })
    clearTenantCache(result.user.email)
    return NextResponse.json({ success: true, message: 'Admin user created successfully', admin: {
      _id: result.user._id, email: result.user.email, role: result.user.role, employee: employeeView(result.employee),
    } })
  } catch (error) { return failure(error) }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const { id } = await params
    const result = await updateFirestoreAdminAccount(await request.json(), { superadmin: { _id: auth.superadmin._id, companyId: id } })
    clearTenantCache(result.user.email)
    return NextResponse.json({ success: true, message: 'Admin user updated successfully', updates: result.updates })
  } catch (error) { return failure(error) }
}
