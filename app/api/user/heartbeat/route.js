import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getAuthAndDatabase } from '@/lib/auth'
const options = { queryFields: { userpresences: ['userId'] }, constraints: { userpresences: [{ fields: ['userId'] }] } }
async function handle(request, remove) {
  try {
    const auth = await getAuthAndDatabase(request, options)
    if (!auth.success) return NextResponse.json({ ok: false }, { status: auth.status || 401 })
    const userId = String(auth.user._id || auth.user.userId), database = auth.database
    const existing = (await database.list('userpresences', { filters: [{ field: 'userId', operator: '==', value: userId }], limit: 2 })).records
    if (existing.length > 1) throw new Error('Ambiguous presence record')
    const id = existing[0]?._id || createHash('sha256').update(userId).digest('hex').slice(0, 24)
    const body = remove ? {} : await request.json().catch(() => ({}))
    await database.transaction(async tx => {
      const current = await tx.get('userpresences', id)
      if (current && String(current.userId) !== userId) throw new Error('Presence identity mismatch')
      if (remove) { if (current) await tx.delete('userpresences', id); return }
      const record = { ...current, _id: id, userId, employeeId: auth.user.employeeId ? String(auth.user.employeeId) : null,
        lastHeartbeat: new Date(), updatedAt: new Date(), currentPage: typeof body.currentPage === 'string' ? body.currentPage.slice(0, 1000) : null,
        userAgent: typeof body.userAgent === 'string' ? body.userAgent.slice(0, 1000) : request.headers.get('user-agent'),
      }
      if (current) await tx.replace('userpresences', record)
      else await tx.create('userpresences', { ...record, createdAt: new Date() })
    })
    return NextResponse.json({ ok: true })
  } catch (error) { return NextResponse.json({ ok: false }, { status: 500 }) }
}
export const POST = request => handle(request, false)
export const DELETE = request => handle(request, true)
