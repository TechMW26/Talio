import { listDepartments, changeDepartment } from '@/lib/organizationApi.server'

export const GET = listDepartments
export const POST = changeDepartment('create')
