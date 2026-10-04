import { NextResponse } from 'next/server'
import { organizationApi } from '@/lib/organizationApi.server'
import { syncDepartmentHeadStatus, getAllDepartmentHeads } from '@/lib/departmentHeadSync'

function adminOnly(handler) {
  return organizationApi({}, async ({ auth, database }) => {
    if (auth.user.role !== 'admin') return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    return NextResponse.json(await handler(database))
  })
}
export const GET = adminOnly(getAllDepartmentHeads)
export const POST = adminOnly(database => syncDepartmentHeadStatus(null, database))
