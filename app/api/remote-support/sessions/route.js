import { handleRemoteSupport } from '@/lib/remoteSupportApi.server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = (request, context) => handleRemoteSupport(request, context, 'sessions')
export const POST = (request, context) => handleRemoteSupport(request, context, 'sessions')
