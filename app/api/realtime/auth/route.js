import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { getPusherServer } from '@/lib/pusherServer'
import { parsePrivateChannel } from '@/lib/platform/realtimeChannels'

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

  if (channel.scope === 'global') return true
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
      .select('createdBy manager members teamMembers')
      .lean()
    if (!project) return false
    return includesId([
      project.createdBy,
      project.manager,
      ...(project.members || []),
      ...(project.teamMembers || []),
    ], userId, employeeId)
  }

  return false
}

export async function POST(request) {
  const form = await request.formData()
  const socketId = String(form.get('socket_id') || '')
  const channelName = String(form.get('channel_name') || '')
  const channel = parsePrivateChannel(channelName)

  if (!socketId || !channel) {
    return NextResponse.json({ error: 'Invalid realtime authorization request' }, { status: 400 })
  }

  const modelNames = channel.scope === 'chat'
    ? ['Chat']
    : channel.scope === 'project' ? ['Project'] : []
  const auth = await getAuthAndModels(request, modelNames)
  if (!auth.success) {
    return NextResponse.json({ error: auth.message }, { status: 401 })
  }

  if (!await authorizeResourceChannel(auth, channel)) {
    return NextResponse.json({ error: 'Forbidden realtime channel' }, { status: 403 })
  }

  try {
    return NextResponse.json(getPusherServer().authorizeChannel(socketId, channelName))
  } catch (error) {
    console.error('[RealtimeAuth] Failed:', error.message)
    return NextResponse.json({ error: 'Realtime service is unavailable' }, { status: 503 })
  }
}
