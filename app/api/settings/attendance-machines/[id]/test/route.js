import mongoose from 'mongoose'
import { apiError, apiSuccess, withTenantApi } from '@/lib/api/route'

export const dynamic = 'force-dynamic'

export const POST = withTenantApi({
  models: ['AttendanceMachine'],
  roles: ['admin', 'hr'],
  features: { allOf: ['attendanceMachines'] },
  errorMessage: 'Machine readiness check failed',
}, async ({ context, models }) => {
  const { id } = await Promise.resolve(context.params)
  if (!mongoose.Types.ObjectId.isValid(id || '')) return apiError('Invalid machine ID', { status: 400 })
  const machine = await models.AttendanceMachine.findById(id).lean()
  if (!machine) return apiError('Attendance machine not found', { status: 404 })
  if (machine.status === 'disabled') return apiError('Enable the machine before testing it', { status: 409 })

  if (machine.connectionMode === 'lan_bridge') {
    const online = machine.lastSeenAt && Date.now() - new Date(machine.lastSeenAt).getTime() < 10 * 60 * 1000
    return apiSuccess({
      ready: Boolean(online),
      state: online ? 'online' : 'awaiting_bridge',
      lastSeenAt: machine.lastSeenAt || null,
    }, { message: online ? 'LAN bridge is online' : 'Configuration is valid; start the LAN bridge to complete the connection' })
  }

  if (machine.connectionMode === 'cloud_api') {
    const ready = Boolean(machine.endpointUrl && machine.credentialsConfigured)
    return apiSuccess({ ready, state: ready ? 'configured' : 'credentials_required' }, {
      message: ready
        ? 'Cloud connection is configured. Talio will verify it during the next sync.'
        : 'Add the vendor HTTPS endpoint and credentials to finish configuration.',
    })
  }

  if (machine.connectionMode === 'file_import') {
    return apiSuccess({ ready: true, state: 'ready_for_import' }, { message: 'Machine is ready for attendance-file imports' })
  }

  return apiSuccess({ ready: true, state: 'awaiting_first_punch' }, {
    message: 'Webhook is ready. Send a signed test punch from the machine or vendor cloud.',
  })
})

