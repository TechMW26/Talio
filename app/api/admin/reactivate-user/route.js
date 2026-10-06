import { handleAdminOperation } from '@/lib/adminOperationsApi.server'
export const dynamic = 'force-dynamic'
export const GET = request => handleAdminOperation(request, 'reactivate-user')
export const POST = request => handleAdminOperation(request, 'reactivate-user')
