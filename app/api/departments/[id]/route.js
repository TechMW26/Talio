import { getDepartment, changeDepartment } from '@/lib/organizationApi.server'

export const GET = getDepartment
export const PUT = changeDepartment('save')
export const DELETE = changeDepartment('delete')
