import { webhookApi } from '@/lib/webhookApi.server'
export const dynamic = 'force-dynamic'
export const GET = request => webhookApi(request, null, 'GET')
export const POST = request => webhookApi(request, null, 'POST')
