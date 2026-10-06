import { recruitmentHandler } from '@/lib/recruitment/api.server'

export const GET = recruitmentHandler('interviews', 'GET', true)
export const PUT = recruitmentHandler('interviews', 'PUT', true)
export const DELETE = recruitmentHandler('interviews', 'DELETE', true)
