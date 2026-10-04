import { supportApi } from '@/lib/supportApi.server'
export const GET = (request, context) => supportApi(request, context, 'tickets', 'GET')
export const PUT = (request, context) => supportApi(request, context, 'tickets', 'PUT')
export const DELETE = (request, context) => supportApi(request, context, 'tickets', 'DELETE')
export const PATCH = PUT
