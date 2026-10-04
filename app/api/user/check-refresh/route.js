import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, { queryFields: { forcerefreshes: ['userId', 'consumed', 'createdAt'] } })
    if (!auth.success) return NextResponse.json({ pending: false })
    const userId = String(auth.user._id || auth.user.userId), cutoff = new Date(Date.now() - 120000)
    const page = await auth.database.list('forcerefreshes', { filters: [{ field: 'userId', operator: '==', value: userId }, { field: 'consumed', operator: '==', value: false }, { field: 'createdAt', operator: '>=', value: cutoff }], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 1 })
    if (!page.records.length) return NextResponse.json({ pending: false })
    const consumed = await auth.database.transaction(async tx => {
      const current = await tx.get('forcerefreshes', String(page.records[0]._id))
      if (!current || current.consumed || current.userId !== userId || new Date(current.createdAt) < cutoff) return null
      await tx.replace('forcerefreshes', { ...current, consumed: true, consumedAt: new Date() })
      return current
    })
    return NextResponse.json(consumed ? { pending: true, message: consumed.message, hard: consumed.hard, initiatedBy: consumed.initiatedBy, timestamp: consumed.createdAt } : { pending: false })
  } catch (error) { return NextResponse.json({ pending: false }, { status: 503 }) }
}
