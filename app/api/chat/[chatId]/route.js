import { handleChat } from '@/lib/chatApi.server'
export const dynamic = 'force-dynamic'
export const GET = (request, context) => handleChat(request, context, 'get')
export const POST = (request, context) => handleChat(request, context, 'leave')
export const DELETE = (request, context) => handleChat(request, context, 'delete')
