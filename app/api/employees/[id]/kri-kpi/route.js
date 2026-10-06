import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function normalizeKpis(kpis) {
  if (!Array.isArray(kpis)) return []
  return kpis
    .map((kpi) => ({
      name: (kpi?.name || '').toString().trim(),
      target: (kpi?.target || '').toString().trim(),
      unit: (kpi?.unit || '').toString().trim(),
      notes: (kpi?.notes || '').toString().trim(),
    }))
    .filter((kpi) => kpi.name)
    .slice(0, 25)
}

function normalizeKris(kris) {
  if (!Array.isArray(kris)) return []
  return kris
    .map((kri) => (typeof kri === 'string' ? kri.trim() : ''))
    .filter(Boolean)
    .slice(0, 25)
}

export async function GET(request, { params }) {
  try {
    const { id } = await params
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    if (!/^[a-f\d]{24}$/i.test(id)) return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
    const employee = await auth.database.get('employees', id)

    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        manualKRIs: employee.manualKRIs || [],
        manualKPIs: employee.manualKPIs || [],
        aiGeneratedKRIs: employee.aiGeneratedKRIs || [],
        aiGeneratedKRIsMeta: employee.aiGeneratedKRIsMeta || null,
      },
    })
  } catch (error) {
    console.error('Employee KRI/KPI GET error:', error)
    return NextResponse.json({ success: false, message: 'Failed to fetch KRI/KPI' }, { status: 500 })
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user } = auth
    const allowed = ['admin', 'hr', 'manager', 'department_head']
    if (!allowed.includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Only HR/Admin/Managers can update KRIs and KPIs' }, { status: 403 })
    }

    const body = await request.json()
    const manualKRIs = normalizeKris(body.manualKRIs)
    const manualKPIs = normalizeKpis(body.manualKPIs)

    if (!/^[a-f\d]{24}$/i.test(id)) return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
    const employee = await auth.database.mutate('employees', id, current => ({ ...current, manualKRIs, manualKPIs, updatedAt: new Date() }))

    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: { _id: employee._id, manualKRIs: employee.manualKRIs, manualKPIs: employee.manualKPIs }, message: 'KRI/KPI updated' })
  } catch (error) {
    console.error('Employee KRI/KPI PUT error:', error)
    return NextResponse.json({ success: false, message: 'Failed to update KRI/KPI' }, { status: 500 })
  }
}
