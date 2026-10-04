import { communicationsApi } from '@/lib/communicationsApi.server'
export const POST = (request, context) => communicationsApi(request, context, 'policies', 'ACKNOWLEDGE')
