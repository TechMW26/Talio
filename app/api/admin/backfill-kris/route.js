import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { generateAndStoreKRIsKPIs } from '@/lib/kriGenerator'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Backfill AI-generated KRIs/KPIs for all employees missing them.
 * Admin / HR only. Returns immediately with a queued count, runs in background.
 *
 * Optional query params:
 *   ?force=true           regenerate even if employee already has KRIs
 *   ?limit=N              cap how many to process this run (default 50)
 */
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const role = auth.user?.role
    if (!['admin', 'hr'].includes(role)) {
      return NextResponse.json({ success: false, message: 'Admin or HR access required' }, { status: 403 })
    }

    const { Employee } = auth.models
    const url = new URL(request.url)
    const force = url.searchParams.get('force') === 'true'
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200)

    const filter = force
      ? { status: { $ne: 'terminated' } }
      : { status: { $ne: 'terminated' }, $or: [{ aiGeneratedKRIs: { $exists: false } }, { aiGeneratedKRIs: { $size: 0 } }] }

    const employees = await Employee.find(filter).select('_id firstName lastName').limit(limit).lean()

    const userId = auth.user?._id || auth.user?.userId

    // Fire-and-forget — process sequentially with small delay to avoid hammering AI provider.
    ;(async () => {
      for (const emp of employees) {
        try {
          await generateAndStoreKRIsKPIs({ Employee, employeeId: emp._id, userId, generateKPIs: true })
        } catch (err) {
          console.error(`[Backfill KRI] Failed for ${emp._id}:`, err.message)
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      console.log(`[Backfill KRI] Completed batch of ${employees.length} employees`)
    })()

    return NextResponse.json({
      success: true,
      message: `Queued ${employees.length} employees for KRI/KPI generation. Re-run to process the next batch.`,
      data: { queued: employees.length, force },
    })
  } catch (error) {
    console.error('Backfill KRI error:', error)
    return NextResponse.json({ success: false, message: error.message || 'Failed to backfill KRIs' }, { status: 500 })
  }
}
