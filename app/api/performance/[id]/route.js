import { performanceApi } from '@/lib/performanceApi.server'
export const GET = (request, context) => performanceApi(request, context, 'reviews', 'GET')
export const PUT = (request, context) => performanceApi(request, context, 'reviews', 'PUT')
export const DELETE = (request, context) => performanceApi(request, context, 'reviews', 'DELETE')
