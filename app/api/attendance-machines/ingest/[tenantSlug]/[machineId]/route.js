import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getTenantBySlug } from '@/lib/tenantContext'
import { getTenantModels } from '@/lib/tenantModels'
import { getTenantCompanyFeaturePayload } from '@/lib/companyFeatures.server'
import { ingestMachinePunches } from '@/lib/attendanceMachines/ingestion.server'
import { readMachineToken, verifyMachineToken } from '@/lib/attendanceMachines/machineSecurity.server'

export const dynamic = 'force-dynamic'

function parseTextPunches(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [employeeCode, timestamp, direction, verificationMode, eventId] = line.split(/[\t,]/)
    return { employeeCode, timestamp, direction, verificationMode, eventId }
  })
}

async function readPayload(request) {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return request.json()
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await request.text()
    const params = new URLSearchParams(text)
    const jsonValue = params.get('events') || params.get('records') || params.get('data')
    if (jsonValue) {
      try { return JSON.parse(jsonValue) } catch { /* use form fields below */ }
    }
    return Object.fromEntries(params.entries())
  }
  return { records: parseTextPunches(await request.text()) }
}

export async function POST(request, { params }) {
  try {
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (contentLength > 1024 * 1024) {
      return NextResponse.json({ success: false, message: 'Payload is too large' }, { status: 413 })
    }

    const { tenantSlug, machineId } = await params
    if (!mongoose.Types.ObjectId.isValid(machineId || '')) {
      return NextResponse.json({ success: false, message: 'Integration endpoint not found' }, { status: 404 })
    }
    const tenant = await getTenantBySlug(tenantSlug)
    if (!tenant) return NextResponse.json({ success: false, message: 'Integration endpoint not found' }, { status: 404 })

    const featurePayload = await getTenantCompanyFeaturePayload({
      companySlug: tenant.slug,
      databaseName: tenant.databaseName,
    })
    if (featurePayload?.features?.attendanceMachines !== true) {
      return NextResponse.json({ success: false, message: 'Attendance machine integrations are disabled' }, { status: 403 })
    }

    const models = await getTenantModels(tenant.databaseName, [
      'AttendanceMachine',
      'AttendanceMachinePunch',
      'Attendance',
      'Employee',
    ])
    const machine = await models.AttendanceMachine.findById(machineId).select('+webhookTokenHash')
    if (!machine || machine.status === 'disabled') {
      return NextResponse.json({ success: false, message: 'Integration endpoint not found' }, { status: 404 })
    }

    const token = readMachineToken(request)
    if (!verifyMachineToken(token, machine.webhookTokenHash)) {
      return NextResponse.json({ success: false, message: 'Invalid machine token' }, { status: 401 })
    }

    const payload = await readPayload(request)
    const result = await ingestMachinePunches({ machine, payload, models })
    machine.lastSeenAt = new Date()
    machine.lastSyncAt = result.processed > 0 ? new Date() : machine.lastSyncAt
    machine.lastError = result.rejected > 0 ? result.errors.slice(0, 3).join('; ').slice(0, 1000) : null
    if (machine.status === 'error' && result.rejected === 0) machine.status = 'active'
    await machine.save()

    return NextResponse.json({ success: true, data: result }, { status: result.rejected === result.received && result.received > 0 ? 422 : 200 })
  } catch (error) {
    console.error('[AttendanceMachineIngest] Failed:', error)
    return NextResponse.json({ success: false, message: 'Attendance punches could not be processed' }, { status: 500 })
  }
}
