import { appraisalApi } from '@/lib/hrms/performanceAppraisalApi.server'
export const POST = (request, context) => appraisalApi(request, context, 'POST')
