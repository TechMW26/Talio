import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getAuthAndModels } from '@/lib/auth'
import { getPusherServer } from '@/lib/pusherServer'
import { parsePrivateChannel } from '@/lib/platform/realtimeChannels'
import { hasDepartmentAuthority } from '@/lib/hierarchyAuth'

export const runtime = 'nodejs'

function includesId(values, userId, employeeId) {
  return (values || []).some((value) => {
    const id = String(value?._id || value?.userId?._id || value?.userId || value)
    return id === userId || id === employeeId
  })
}

async function authorizeResourceChannel(auth, channel) {
  const userId = String(auth.user._id || auth.user.userId)
  const employeeId = String(auth.user.employeeId?._id || auth.user.employeeId || '')

  if (channel.scope === 'global') return false
  if (channel.scope === 'user') return channel.resourceId === userId
  if (channel.scope === 'tenant') return channel.resourceId === auth.tenant.databaseName

  if (channel.scope === 'chat') {
    const chat = await auth.models.Chat.findById(channel.resourceId)
      .select('participants')
      .lean()
    return Boolean(chat && includesId(chat.participants, userId, employeeId))
  }

  if (channel.scope === 'project') {
    const project = await auth.models.Project.findById(channel.resourceId)
      .select('createdBy projectHead projectHeads department assignedTeams')
      .lean()
    if (!project) return false
    if (['admin', 'hr'].includes(auth.user.role)
      || includesId([project.createdBy, project.projectHead, ...(project.projectHeads || [])], userId, employeeId)
      || (project.department && hasDepartmentAuthority(auth.user, String(project.department)))
      || (auth.user.teamLeaderOf || []).some(id => includesId(project.assignedTeams, String(id), ''))) return true
    if (!employeeId) return false
    return Boolean(await auth.models.ProjectMember.exists({ project: channel.resourceId, user: employeeId }))
  }

  return false
}

export async function POST(request) {
  let form
  try { form = await request.formData() } catch {
    return NextResponse.json({ error: 'Invalid realtime authorization request' }, { status: 400 })
  }
  const socketId = String(form.get('socket_id') || '')
  const channelName = String(form.get('channel_name') || '')
  const channel = parsePrivateChannel(channelName)

  if (!/^\d+\.\d+$/.test(socketId) || !channel
    || (['chat', 'project', 'user'].includes(channel.scope) && !mongoose.isValidObjectId(channel.resourceId))) {
    return NextResponse.json({ error: 'Invalid realtime authorization request' }, { status: 400 })
  }

  const modelNames = channel.scope === 'chat'
    ? ['Chat']
    : channel.scope === 'project' ? ['Project', 'ProjectMember'] : []
  const auth = await getAuthAndModels(request, modelNames)
  if (!auth.success) {
    return NextResponse.json({ error: auth.message }, { status: 401 })
  }

  try {
    if (!await authorizeResourceChannel(auth, channel)) {
      return NextResponse.json({ error: 'Forbidden realtime channel' }, { status: 403 })
    }
    return NextResponse.json(getPusherServer().authorizeChannel(socketId, channelName))
  } catch (error) {
    console.error('[RealtimeAuth] Failed:', error.message)
    return NextResponse.json({ error: 'Realtime service is unavailable' }, { status: 503 })
  }
}
