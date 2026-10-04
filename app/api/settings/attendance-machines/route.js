import { randomBytes } from 'node:crypto'
import { ATTENDANCE_DATABASE_OPTIONS, listAttendanceRecords } from '@/lib/platform/firestoreAttendance.server'
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
  firestore: ATTENDANCE_DATABASE_OPTIONS,
  roles: ['admin', 'hr'],
  features: { allOf: ['attendanceMachines'] },
  errorMessage: 'Attendance machine request failed',
}

export const GET = withTenantApi(routeConfig, async ({ request, auth, database }) => {
  const { searchParams } = new URL(request.url)
  const scope = searchParams.get('scope')
  const companyId = searchParams.get('companyId')
  const filters = []
  if (['organisation', 'company'].includes(scope)) filters.push({ field: 'scope', operator: '==', value: scope })
  if (companyId) {
    if (!/^[a-f\d]{24}$/i.test(companyId)) return apiError('Invalid company ID', { status: 400 })
    filters.push({ field: 'company', operator: '==', value: companyId })
  }

  const records = await listAttendanceRecords(database, 'attendancemachines', filters, 2000)
  const machines = await Promise.all(records.map(async machine => {
    const company = machine.company ? await database.get('companies', String(machine.company)) : null
    return { ...machine, company: company ? { _id: company._id, name: company.name, code: company.code } : null }
  }))
  machines.sort((a, b) => String(a.scope).localeCompare(String(b.scope)) || String(a.name).localeCompare(String(b.name)))

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

export const POST = withTenantApi(routeConfig, async ({ request, auth, database }) => {
  const input = await request.json()
  const validation = await validateMachineInput(input, { database })
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
    const machine = await database.create('attendancemachines', {
      _id: randomBytes(12).toString('hex'), status: 'active', punchDirectionMode: 'first_last', employeeCodeField: 'employeeCode',
      ...validation.data,
      credentials: encryptedCredentials,
      credentialsConfigured: Object.keys(encryptedCredentials).length > 0,
      webhookTokenHash: hashMachineToken(token),
      webhookTokenLastFour: token.slice(-4),
      createdBy: auth.user._id,
      updatedBy: auth.user._id,
      createdAt: new Date(), updatedAt: new Date(),
    })
    machine.company = validation.company ? { _id: validation.company._id, name: validation.company.name, code: validation.company.code } : null

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
    if (error?.code === 'ALREADY_EXISTS' || error?.code === 6 || error?.code === 'UNIQUE_CONSTRAINT') {
      return apiError('A machine with this provider and serial number already exists', {
        status: 409,
        code: 'DUPLICATE_MACHINE',
      })
    }
    throw error
  }
})
