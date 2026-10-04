import { handleAdminOperation } from '@/lib/adminOperationsApi.server'
export const dynamic = 'force-dynamic'
export const POST = request => handleAdminOperation(request, 'presence')
