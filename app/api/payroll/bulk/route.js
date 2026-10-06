import { bulkPayrollApi } from '@/lib/financeApi.server'
export const POST = request => bulkPayrollApi(request)
export const DELETE = request => bulkPayrollApi(request, true)
