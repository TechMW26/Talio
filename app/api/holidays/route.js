import { supportApi } from '@/lib/supportApi.server'
export const GET = request => supportApi(request, null, 'holidays', 'GET')
export const POST = request => supportApi(request, null, 'holidays', 'POST')
