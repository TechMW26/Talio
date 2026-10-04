import { handleLeaveRequest } from '@/lib/leaveApi.server'
export const PUT = (request, { params }) => handleLeaveRequest(request, { params, method: 'PUT' })
export const DELETE = (request, { params }) => handleLeaveRequest(request, { params, method: 'DELETE' })
