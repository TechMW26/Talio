import { handleAdminOperation } from '@/lib/adminOperationsApi.server'
export const dynamic = 'force-dynamic'
export const DELETE = request => handleAdminOperation(request, 'clear-chats')
