import { performanceApi } from '@/lib/performanceApi.server'
export const GET = request => performanceApi(request, null, 'reviews', 'GET')
export const POST = request => performanceApi(request, null, 'reviews', 'POST')
