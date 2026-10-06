import { listTeams, changeTeam } from '@/lib/organizationApi.server'

export const GET = listTeams
export const POST = changeTeam('create')
