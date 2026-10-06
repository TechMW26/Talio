import { communicationsApi } from '@/lib/communicationsApi.server'
export const GET = (request, context) => communicationsApi(request, context, 'announcements', 'GET')
export const PUT = (request, context) => communicationsApi(request, context, 'announcements', 'PUT')
export const DELETE = (request, context) => communicationsApi(request, context, 'announcements', 'DELETE')
