import { financeApi } from '@/lib/financeApi.server'
export const GET = (request, context) => financeApi(request, context, 'payrolls', 'GET', true)
export const PUT = (request, context) => financeApi(request, context, 'payrolls', 'PUT', true)
export const PATCH = PUT
export const DELETE = (request, context) => financeApi(request, context, 'payrolls', 'DELETE', true)
