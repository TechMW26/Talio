import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

const MAX_PRESENCE_IDS = 200
const ACTIVE_WINDOW_MS = 2 * 60 * 1000

export async function POST(request) {
  const auth = await getAuthAndModels(request, ['UserPresence'])
  if (!auth.success) {
    return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const employeeIds = [...new Set(
    (Array.isArray(body.employeeIds) ? body.employeeIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  )].slice(0, MAX_PRESENCE_IDS)

  if (employeeIds.length === 0) {
    return NextResponse.json({ employees: {} })
  }

  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS)
  const presences = await auth.models.UserPresence.find({
    employeeId: { $in: employeeIds },
    lastHeartbeat: { $gte: activeSince },
  }).select('employeeId lastHeartbeat currentPage').lean()

  const activeByEmployee = new Map(
    presences.map((presence) => [String(presence.employeeId), presence]),
  )
  const employees = Object.fromEntries(employeeIds.map((employeeId) => {
    const presence = activeByEmployee.get(employeeId)
    return [employeeId, {
      online: Boolean(presence),
      lastSeen: presence?.lastHeartbeat || null,
      currentPage: presence?.currentPage || null,
    }]
  }))

  return NextResponse.json({ employees })
}
