import { scheduledNotificationsApi } from '@/lib/scheduledNotificationsApi.server'
export const GET = request => scheduledNotificationsApi(request, 'recurring', 'GET')
export const POST = request => scheduledNotificationsApi(request, 'recurring', 'POST')
export const PUT = request => scheduledNotificationsApi(request, 'recurring', 'PUT')
export const PATCH = request => scheduledNotificationsApi(request, 'recurring', 'PATCH')
export const DELETE = request => scheduledNotificationsApi(request, 'recurring', 'DELETE')

