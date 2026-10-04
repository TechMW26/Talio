import { communicationsApi } from '@/lib/communicationsApi.server'
export const GET = request => communicationsApi(request, null, 'announcements', 'GET')
export const POST = request => communicationsApi(request, null, 'announcements', 'POST')
