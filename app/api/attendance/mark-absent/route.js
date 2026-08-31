import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { getAbsenceStatus, processAbsenceDate } from '@/lib/services/attendanceAbsenceService.server'
import { getStartOfDayInTimezone } from '@/lib/timezone'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL_NAMES = ['Attendance', 'Employee', 'Leave', 'Holiday', 'CompanySettings', 'Company']

function parseDate(value, label) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`Invalid ${label} format`)
  return parsed
}

function yesterday() {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - 1)
  return date
}

export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, MODEL_NAMES)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    if (!['admin', 'hr'].includes(auth.user.role)) {
      return NextResponse.json({ success: false, message: 'Admin or HR access required' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const start = parseDate(body.date || body.startDate, body.date ? 'date' : 'startDate') || yesterday()
    const end = parseDate(body.date || body.endDate, body.date ? 'date' : 'endDate') || start
    if (start > end) return NextResponse.json({ success: false, message: 'startDate must not be after endDate' }, { status: 400 })

    const today = getStartOfDayInTimezone(new Date(), 'Asia/Kolkata')
    if (getStartOfDayInTimezone(start, 'Asia/Kolkata') >= today) {
      return NextResponse.json({ success: false, message: 'Cannot mark absent for today or future dates' }, { status: 400 })
    }
    const maximumDays = 92
    if ((end.getTime() - start.getTime()) / 86_400_000 > maximumDays) {
      return NextResponse.json({ success: false, message: `Date range cannot exceed ${maximumDays} days` }, { status: 400 })
    }

    const results = []
    const cursor = new Date(start)
    while (cursor <= end) {
      results.push(await processAbsenceDate({
        models: auth.models,
        date: cursor,
        dryRun: body.dryRun === true,
        sendNotifications: body.sendNotifications === true,
      }))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    const marked = results.reduce((sum, item) => sum + item.marked, 0)
    return NextResponse.json({
      success: true,
      message: body.dryRun ? `[DRY RUN] ${marked} absence record(s) would be created` : `${marked} absence record(s) created`,
      data: { marked, processedDays: results.filter((item) => !item.skipped).length, dates: results, dryRun: body.dryRun === true },
    })
  } catch (error) {
    const status = error instanceof TypeError ? 400 : 500
    console.error('[Mark absent] Failed:', error)
    return NextResponse.json({ success: false, message: error.message }, { status })
  }
}

export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, MODEL_NAMES)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const date = parseDate(new URL(request.url).searchParams.get('date'), 'date') || yesterday()
    const data = await getAbsenceStatus({ models: auth.models, date })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    const status = error instanceof TypeError ? 400 : 500
    console.error('[Absence status] Failed:', error)
    return NextResponse.json({ success: false, message: error.message }, { status })
  }
}
