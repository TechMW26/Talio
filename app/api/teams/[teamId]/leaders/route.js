import { getTeam, changeTeam } from '@/lib/organizationApi.server'

export const GET = getTeam('leaders')
export const POST = changeTeam('leaders-add')
export const DELETE = changeTeam('leaders-remove')
