import { scheduledNotificationsApi } from '@/lib/scheduledNotificationsApi.server'
export const POST = request => scheduledNotificationsApi(request, 'send', 'POST')

