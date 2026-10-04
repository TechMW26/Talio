import { financeApi } from '@/lib/financeApi.server'
export const GET = request => financeApi(request, null, 'payslips', 'GET')
export const POST = request => financeApi(request, null, 'payslips', 'POST')
