import mongoose from 'mongoose'
import { apiError, apiSuccess, withTenantApi } from '@/lib/api/route'
import {
  buildEncryptedCredentials,
  serializeMachine,
  validateMachineInput,
} from '@/lib/attendanceMachines/machineConfig.server'
import {
  createMachineToken,
  hashMachineToken,
} from '@/lib/attendanceMachines/machineSecurity.server'

export const dynamic = 'force-dynamic'

const routeConfig = {
  models: ['AttendanceMachine', 'Company'],
  roles: ['admin', 'hr'],
  features: { allOf: ['attendanceMachines'] },
  errorMessage: 'Attendance machine update failed',
}

function machineIdFrom(context) {
  return Promise.resolve(context.params).then(({ id }) => id)
}

export const PATCH = withTenantApi(routeConfig, async ({ request, context, auth, models }) => {
  const id = await machineIdFrom(context)
  if (!mongoose.Types.ObjectId.isValid(id || '')) return apiError('Invalid machine ID', { status: 400 })

  const machine = await models.AttendanceMachine.findById(id).select('+credentials.usernameEncrypted +credentials.passwordEncrypted +credentials.apiKeyEncrypted')
  if (!machine) return apiError('Attendance machine not found', { status: 404 })

  const input = await request.json()
  const merged = {
    name: machine.name,
    providerKey: machine.providerKey,
    model: machine.model,
    serialNumber: machine.serialNumber,
    scope: machine.scope,
    companyId: machine.company?.toString() || '',
    locationName: machine.locationName,
    connectionMode: machine.connectionMode,
    endpointUrl: machine.endpointUrl,
    host: machine.host,
    port: machine.port,
    siteId: machine.siteId,
    duplicateWindowSeconds: machine.duplicateWindowSeconds,
    punchDirectionMode: machine.punchDirectionMode,
    employeeCodeField: machine.employeeCodeField,
    status: machine.status,
    ...input,
  }
  const validation = await validateMachineInput(merged, { Company: models.Company })
  if (!validation.valid) {
    return apiError('Please correct the machine configuration', {
      status: 400,
      code: 'INVALID_MACHINE_CONFIGURATION',
      details: { errors: validation.errors },
    })
  }

  const credentialUpdate = buildEncryptedCredentials(input, machine.credentialsConfigured)
  const update = {
    ...validation.data,
    ...credentialUpdate.update,
    credentialsConfigured: credentialUpdate.credentialsConfigured,
    updatedBy: auth.user._id,
  }
  let setupToken = null
  if (input.rotateSetupToken === true) {
    setupToken = createMachineToken()
    update.webhookTokenHash = hashMachineToken(setupToken)
    update.webhookTokenLastFour = setupToken.slice(-4)
  }

  try {
    const updated = await models.AttendanceMachine.findByIdAndUpdate(id, { $set: update }, {
      new: true,
      runValidators: true,
    }).populate('company', 'name code')
    return apiSuccess({
      machine: serializeMachine(updated, {
        companySlug: auth.tenant.companySlug,
        origin: new URL(request.url).origin,
      }),
      ...(setupToken ? { setupToken } : {}),
    }, { message: setupToken ? 'Machine updated and setup token rotated' : 'Machine updated' })
  } catch (error) {
    if (error?.code === 11000) return apiError('A machine with this provider and serial number already exists', { status: 409 })
    throw error
  }
})

export const DELETE = withTenantApi(routeConfig, async ({ context, auth, models }) => {
  const id = await machineIdFrom(context)
  if (!mongoose.Types.ObjectId.isValid(id || '')) return apiError('Invalid machine ID', { status: 400 })

  const machine = await models.AttendanceMachine.findByIdAndUpdate(id, {
    $set: { status: 'disabled', updatedBy: auth.user._id },
  }, { new: true })
  if (!machine) return apiError('Attendance machine not found', { status: 404 })
  return apiSuccess(null, { message: 'Attendance machine disabled' })
})

