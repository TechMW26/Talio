import { handleRemoteSupport } from '@/lib/remoteSupportApi.server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const PATCH = (request, context) => handleRemoteSupport(request, context, 'session')
