import { financeApi } from '@/lib/financeApi.server'
export const GET = request => financeApi(request, null, 'payrolls', 'GET')
export const POST = request => financeApi(request, null, 'payrolls', 'POST')
