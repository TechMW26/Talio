import { assetsApi } from '@/lib/assetsApi.server'
export const PUT = (request, context) => assetsApi(request, context, 'PUT')
export const DELETE = (request, context) => assetsApi(request, context, 'DELETE')

