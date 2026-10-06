import { recruitmentHandler } from '@/lib/recruitment/api.server'

export const GET = recruitmentHandler('jobpostings', 'GET', true)
export const PUT = recruitmentHandler('jobpostings', 'PUT', true)
export const DELETE = recruitmentHandler('jobpostings', 'DELETE', true)

