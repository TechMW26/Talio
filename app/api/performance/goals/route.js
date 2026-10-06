import { performanceApi } from '@/lib/performanceApi.server'
export const GET = request => performanceApi(request, null, 'goals', 'GET')
export const POST = request => performanceApi(request, null, 'goals', 'POST')
export const PUT = request => performanceApi(request, null, 'goals', 'PUT')
export const DELETE = request => performanceApi(request, null, 'goals', 'DELETE')
