import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { readAdminPage } from '@/lib/platform/firestoreSuperadmin.server'
export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, { queryFields: { users: ['createdAt'] } })
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    if (auth.user.role !== 'admin') return NextResponse.json({ message: 'Access denied. Admin only.' }, { status: 403 })
    const query = new URL(request.url).searchParams
    const limit = Math.min(1000, Math.max(1, Number(query.get('limit')) || 1000))
    const page = await readAdminPage(auth.database, 'users', { orderBy: [{ field: 'createdAt', direction: 'desc' }], cursor: query.get('cursor'), limit })
    const data = []
    for (let offset = 0; offset < page.records.length; offset += 20) data.push(...await Promise.all(page.records.slice(offset, offset + 20).map(async user => {
      const employee = user.employeeId ? await auth.database.get('employees', String(user.employeeId)) : null
      return { _id: user._id, email: user.email, role: user.role, roleId: user.roleId, isActive: user.isActive, forcePasswordChange: user.forcePasswordChange, lastLogin: user.lastLogin, createdAt: user.createdAt, updatedAt: user.updatedAt,
        employeeId: employee ? { _id: employee._id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode } : null }
    })))
    return NextResponse.json({ success: true, data, nextCursor: page.nextCursor })
  } catch (error) { return NextResponse.json({ message: 'Internal server error' }, { status: 500 }) }
}
