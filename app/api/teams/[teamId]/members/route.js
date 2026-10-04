import { getTeam, changeTeam } from '@/lib/organizationApi.server'

export const GET = getTeam('members')
export const POST = changeTeam('members-add')
export const DELETE = changeTeam('members-remove')
