import { handleChat } from '@/lib/chatApi.server'
export const dynamic = 'force-dynamic'
export const POST = (request, context) => handleChat(request, context, 'leave')
