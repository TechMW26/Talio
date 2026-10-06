import { appraisalApi } from '@/lib/hrms/performanceAppraisalApi.server'
export const GET = request => appraisalApi(request, null, 'GET')
export const POST = request => appraisalApi(request, null, 'POST')
