import { financeApi } from '@/lib/financeApi.server'
export const PUT = (request, context) => financeApi(request, context, 'expenses', 'PUT', true)
export const DELETE = (request, context) => financeApi(request, context, 'expenses', 'DELETE', true)
