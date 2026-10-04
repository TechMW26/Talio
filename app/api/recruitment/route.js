import { recruitmentHandler } from '@/lib/recruitment/api.server'

export const GET = recruitmentHandler('jobpostings', 'GET', false)
export const POST = recruitmentHandler('jobpostings', 'POST', false)

