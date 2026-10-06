import { handleLeaveRequest } from '@/lib/leaveApi.server'
export const PUT = (request, { params }) => handleLeaveRequest(request, { params, actionEndpoint: true, method: 'PUT' })
