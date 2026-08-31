import mongoose from 'mongoose'
import { apiError, apiSuccess, withTenantApi } from '@/lib/api/route'
import { parseAttendanceCsv } from '@/lib/attendanceMachines/csvImport'
import { ingestMachinePunches } from '@/lib/attendanceMachines/ingestion.server'

export const dynamic = 'force-dynamic'

export const POST = withTenantApi({
  models: ['AttendanceMachine', 'AttendanceMachinePunch', 'Attendance', 'Employee'],
  roles: ['admin', 'hr'],
  features: { allOf: ['attendanceMachines'] },
  errorMessage: 'Attendance file import failed',
}, async ({ request, context, models }) => {
  const { id } = await Promise.resolve(context.params)
  if (!mongoose.Types.ObjectId.isValid(id || '')) return apiError('Invalid machine ID', { status: 400 })
  const machine = await models.AttendanceMachine.findById(id)
  if (!machine) return apiError('Attendance machine not found', { status: 404 })
  if (machine.status === 'disabled') return apiError('Enable the machine before importing punches', { status: 409 })

  const formData = await request.formData()
  const file = formData.get('file')
  if (!file || typeof file.text !== 'function') return apiError('Choose a CSV attendance file', { status: 400 })
  if (file.size > 5 * 1024 * 1024) return apiError('CSV file must be 5 MB or smaller', { status: 413 })

  const records = parseAttendanceCsv(await file.text())
  if (records.length === 0) {
    return apiError('No attendance rows were found. Include a header and at least one punch.', { status: 400 })
  }
  if (records.length > 1000) {
    return apiError('Import up to 1,000 punches at a time', { status: 400 })
  }

  const result = await ingestMachinePunches({ machine, payload: { records }, models })
  machine.lastSeenAt = new Date()
  machine.lastSyncAt = result.processed > 0 ? new Date() : machine.lastSyncAt
  machine.lastError = result.rejected > 0 ? result.errors.slice(0, 3).join('; ').slice(0, 1000) : null
  await machine.save()

  return apiSuccess(result, {
    message: `Imported ${result.processed} punch${result.processed === 1 ? '' : 'es'}; ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} skipped.`,
  })
})
