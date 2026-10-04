import { handleMiraHistory } from '@/lib/miraChatApi.server'
export const dynamic = 'force-dynamic'
export const GET = (request, context) => handleMiraHistory(request, context, 'tokens')
