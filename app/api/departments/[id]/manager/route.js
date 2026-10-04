import { changeDepartment } from '@/lib/organizationApi.server'

export const POST = changeDepartment('managers-add')
export const DELETE = changeDepartment('managers-remove')
