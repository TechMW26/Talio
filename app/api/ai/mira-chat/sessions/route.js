import { handleMiraHistory } from '@/lib/miraChatApi.server'
export const dynamic = 'force-dynamic'
export const GET = (request, context) => handleMiraHistory(request, context, 'sessions')
export const POST = (request, context) => handleMiraHistory(request, context, 'sessions')
