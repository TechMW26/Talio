import { recruitmentHandler } from '@/lib/recruitment/api.server'

export const GET = recruitmentHandler('candidates', 'GET', true)
export const PUT = recruitmentHandler('candidates', 'PUT', true)
export const DELETE = recruitmentHandler('candidates', 'DELETE', true)
