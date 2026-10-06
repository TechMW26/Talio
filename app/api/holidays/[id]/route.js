import { supportApi } from '@/lib/supportApi.server'
export const GET = (request, context) => supportApi(request, context, 'holidays', 'GET')
export const PUT = (request, context) => supportApi(request, context, 'holidays', 'PUT')
export const DELETE = (request, context) => supportApi(request, context, 'holidays', 'DELETE')
