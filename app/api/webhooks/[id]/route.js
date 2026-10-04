import { webhookApi } from '@/lib/webhookApi.server'
export const dynamic = 'force-dynamic'
export const GET = (request, { params }) => webhookApi(request, params, 'GET')
export const POST = (request, { params }) => webhookApi(request, params, 'POST')
export const PUT = (request, { params }) => webhookApi(request, params, 'PUT')
export const DELETE = (request, { params }) => webhookApi(request, params, 'DELETE')
