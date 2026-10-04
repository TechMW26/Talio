import { recruitmentHandler } from '@/lib/recruitment/api.server'

export const GET = recruitmentHandler('candidates', 'GET', false)
export const POST = recruitmentHandler('candidates', 'POST', false)
