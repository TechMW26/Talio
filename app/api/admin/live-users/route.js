import { handleAdminOperation } from '@/lib/adminOperationsApi.server'
export const dynamic = 'force-dynamic'
export const GET = request => handleAdminOperation(request, 'live-users')
