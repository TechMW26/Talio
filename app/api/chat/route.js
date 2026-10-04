import { handleChat } from '@/lib/chatApi.server'
export const dynamic = 'force-dynamic'
export const GET = (request, context) => handleChat(request, context, 'list')
export const POST = (request, context) => handleChat(request, context, 'create')

