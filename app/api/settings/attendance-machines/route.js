import mongoose from 'mongoose'
import { apiError, apiSuccess, withTenantApi } from '@/lib/api/route'
import { encryptSecret } from '@/lib/secretEncryption'
import {
  ATTENDANCE_MACHINE_CONNECTION_MODES,
  ATTENDANCE_MACHINE_PROVIDERS,
} from '@/lib/attendanceMachines/providerRegistry'
import {
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
  errorMessage: 'Attendance machine request failed',
}

export const GET = withTenantApi(routeConfig, async ({ request, auth, models }) => {
  const { searchParams } = new URL(request.url)
  const scope = searchParams.get('scope')
  const companyId = searchParams.get('companyId')
  const query = {}
  if (['organisation', 'company'].includes(scope)) query.scope = scope
  if (companyId) {
    if (!mongoose.Types.ObjectId.isValid(companyId)) return apiError('Invalid company ID', { status: 400 })
    query.company = companyId
  }

  const machines = await models.AttendanceMachine.find(query)
    .populate('company', 'name code')
    .sort({ scope: 1, name: 1 })
    .lean()

  const origin = new URL(request.url).origin
  return apiSuccess({
    machines: machines.map((machine) => serializeMachine(machine, {
      companySlug: auth.tenant.companySlug,
      origin,
    })),
    providers: ATTENDANCE_MACHINE_PROVIDERS,
    connectionModes: ATTENDANCE_MACHINE_CONNECTION_MODES,
  })
})

export const POST = withTenantApi(routeConfig, async ({ request, auth, models }) => {
  const input = await request.json()
  const validation = await validateMachineInput(input, { Company: models.Company })
  if (!validation.valid) {
    return apiError('Please correct the machine configuration', {
      status: 400,
      code: 'INVALID_MACHINE_CONFIGURATION',
      details: { errors: validation.errors },
    })
  }

  const token = createMachineToken()
  const credentials = input.credentials || {}
  const encryptedCredentials = {
    ...(credentials.username?.trim() ? { usernameEncrypted: encryptSecret(credentials.username.trim()) } : {}),
    ...(credentials.password?.trim() ? { passwordEncrypted: encryptSecret(credentials.password.trim()) } : {}),
    ...(credentials.apiKey?.trim() ? { apiKeyEncrypted: encryptSecret(credentials.apiKey.trim()) } : {}),
  }

  try {
    const machine = await models.AttendanceMachine.create({
      ...validation.data,
      credentials: encryptedCredentials,
      credentialsConfigured: Object.keys(encryptedCredentials).length > 0,
      webhookTokenHash: hashMachineToken(token),
      webhookTokenLastFour: token.slice(-4),
      createdBy: auth.user._id,
      updatedBy: auth.user._id,
    })
    await machine.populate('company', 'name code')

    return apiSuccess({
      machine: serializeMachine(machine, {
        companySlug: auth.tenant.companySlug,
        origin: new URL(request.url).origin,
      }),
      setupToken: token,
    }, {
      status: 201,
      message: 'Attendance machine added. Copy the setup token now; it will not be shown again.',
    })
  } catch (error) {
    if (error?.code === 11000) {
      return apiError('A machine with this provider and serial number already exists', {
        status: 409,
        code: 'DUPLICATE_MACHINE',
      })
    }
    throw error
  }
})
