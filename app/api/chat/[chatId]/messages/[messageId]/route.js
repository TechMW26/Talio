import { handleChat } from '@/lib/chatApi.server'
export const dynamic = 'force-dynamic'
export const DELETE = (request, context) => handleChat(request, context, 'delete-message')

