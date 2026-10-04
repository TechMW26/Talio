import { scheduledNotificationsApi } from '@/lib/scheduledNotificationsApi.server'
export const GET = request => scheduledNotificationsApi(request, 'scheduled', 'GET')
export const POST = request => scheduledNotificationsApi(request, 'scheduled', 'POST')
export const DELETE = request => scheduledNotificationsApi(request, 'scheduled', 'DELETE')

