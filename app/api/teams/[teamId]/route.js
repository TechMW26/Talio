import { getTeam, changeTeam } from '@/lib/organizationApi.server'

export const GET = getTeam()
export const PUT = changeTeam('save')
export const DELETE = changeTeam('delete')
