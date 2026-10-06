import { handleChat } from '@/lib/chatApi.server'
export const dynamic = 'force-dynamic'
export const GET = (request, context) => handleChat(request, context, 'messages')
export const POST = (request, context) => handleChat(request, context, 'send')
