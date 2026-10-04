import { supportApi } from '@/lib/supportApi.server'
export const POST = (request, context) => supportApi(request, context, 'comments', 'POST')
