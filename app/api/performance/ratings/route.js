import { ratingsApi } from '@/lib/performanceApi.server'
export const GET = request => ratingsApi(request)
export const DELETE = request => ratingsApi(request, true)
