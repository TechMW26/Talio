import { ATTENDANCE_DATABASE_OPTIONS } from '@/lib/platform/firestoreAttendance.server'
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
  firestore: ATTENDANCE_DATABASE_OPTIONS,
  roles: ['admin', 'hr'],
  features: { allOf: ['attendanceMachines'] },
  errorMessage: 'Attendance machine update failed',
}

function machineIdFrom(context) {
  return Promise.resolve(context.params).then(({ id }) => id)
}

export const PATCH = withTenantApi(routeConfig, async ({ request, context, auth, database }) => {
  const id = await machineIdFrom(context)
  if (!/^[a-f\d]{24}$/i.test(id || '')) return apiError('Invalid machine ID', { status: 400 })

  const machine = await database.get('attendancemachines', id)
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
  const validation = await validateMachineInput(merged, { database })
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
    const updated = await database.mutate('attendancemachines', id, current => ({ ...current, ...update,
      credentials: { ...current.credentials, ...Object.fromEntries(Object.entries(credentialUpdate.update).map(([key, value]) => [key.replace('credentials.', ''), value])) }, updatedAt: new Date(),
    }))
    if (!updated) return apiError('Attendance machine not found', { status: 404 })
    updated.company = validation.company ? { _id: validation.company._id, name: validation.company.name, code: validation.company.code } : null
    return apiSuccess({
      machine: serializeMachine(updated, {
        companySlug: auth.tenant.companySlug,
        origin: new URL(request.url).origin,
      }),
      ...(setupToken ? { setupToken } : {}),
    }, { message: setupToken ? 'Machine updated and setup token rotated' : 'Machine updated' })
  } catch (error) {
    if (error?.code === 'ALREADY_EXISTS' || error?.code === 6 || error?.code === 'UNIQUE_CONSTRAINT') return apiError('A machine with this provider and serial number already exists', { status: 409 })
    throw error
  }
})

export const DELETE = withTenantApi(routeConfig, async ({ context, auth, database }) => {
  const id = await machineIdFrom(context)
  if (!/^[a-f\d]{24}$/i.test(id || '')) return apiError('Invalid machine ID', { status: 400 })

  const machine = await database.mutate('attendancemachines', id, current => ({ ...current, status: 'disabled', updatedBy: auth.user._id, updatedAt: new Date() }))
  if (!machine) return apiError('Attendance machine not found', { status: 404 })
  return apiSuccess(null, { message: 'Attendance machine disabled' })
})
