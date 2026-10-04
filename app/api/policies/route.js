import { communicationsApi } from '@/lib/communicationsApi.server'
export const GET = request => communicationsApi(request, null, 'policies', 'GET')
export const POST = request => communicationsApi(request, null, 'policies', 'POST')
