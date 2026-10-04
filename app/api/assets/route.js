import { assetsApi } from '@/lib/assetsApi.server'
export const GET = request => assetsApi(request, null, 'GET')
export const POST = request => assetsApi(request, null, 'POST')

