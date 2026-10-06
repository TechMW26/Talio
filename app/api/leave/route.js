import { handleLeaveRequest } from '@/lib/leaveApi.server'
export const dynamic = 'force-dynamic'
export const GET = request => handleLeaveRequest(request, { method: 'GET' })
export const POST = request => handleLeaveRequest(request, { method: 'POST' })

