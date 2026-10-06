import { scheduledNotificationsApi } from '@/lib/scheduledNotificationsApi.server'
export const dynamic = 'force-dynamic'
export const GET = request => scheduledNotificationsApi(request, 'process', 'GET')

