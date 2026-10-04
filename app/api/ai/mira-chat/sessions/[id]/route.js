import { handleMiraHistory } from '@/lib/miraChatApi.server'
export const dynamic = 'force-dynamic'
export const GET = (request, context) => handleMiraHistory(request, context, 'session')
export const PATCH = (request, context) => handleMiraHistory(request, context, 'session')
export const DELETE = (request, context) => handleMiraHistory(request, context, 'session')
