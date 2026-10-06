import { recruitmentHandler } from '@/lib/recruitment/api.server'

export const GET = recruitmentHandler('interviews', 'GET', false)
export const POST = recruitmentHandler('interviews', 'POST', false)
