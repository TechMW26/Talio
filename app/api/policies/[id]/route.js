import { communicationsApi } from '@/lib/communicationsApi.server'
export const PUT = (request, context) => communicationsApi(request, context, 'policies', 'PUT')
export const DELETE = (request, context) => communicationsApi(request, context, 'policies', 'DELETE')
