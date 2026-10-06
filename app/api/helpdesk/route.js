import { supportApi } from '@/lib/supportApi.server'
export const GET = request => supportApi(request, null, 'tickets', 'GET')
export const POST = request => supportApi(request, null, 'tickets', 'POST')
