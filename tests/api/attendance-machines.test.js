import {
  getAttendanceMachineProvider,
  isSupportedConnectionMode,
  searchAttendanceMachineProviders,
} from '@/lib/attendanceMachines/providerRegistry'
import {
  extractMachineRecords,
  normalizeMachinePunch,
} from '@/lib/attendanceMachines/ingestion.server'
import {
  createMachineToken,
  hashMachineToken,
  verifyMachineToken,
} from '@/lib/attendanceMachines/machineSecurity.server'
import { validateMachineInput } from '@/lib/attendanceMachines/machineConfig.server'
import { parseAttendanceCsv } from '@/lib/attendanceMachines/csvImport'

describe('attendance machine provider registry', () => {
  test('finds providers by brand, model and protocol keyword', () => {
    expect(searchAttendanceMachineProviders('ZKTeco')[0].key).toBe('zkteco')
    expect(searchAttendanceMachineProviders('MinMoe').some(({ key }) => key === 'hikvision')).toBe(true)
    expect(searchAttendanceMachineProviders('FAPI').some(({ key }) => key === 'matrix_cosec')).toBe(true)
  })

  test('keeps a generic adapter for unlisted and future hardware', () => {
    expect(getAttendanceMachineProvider('custom')?.modes).toEqual(expect.arrayContaining(['push_http', 'lan_bridge']))
    expect(isSupportedConnectionMode('suprema', 'push_http')).toBe(false)
  })
})

describe('attendance machine configuration', () => {
  const Company = {
    findOne: jest.fn(() => ({ select: () => ({ lean: async () => ({ _id: '507f1f77bcf86cd799439011', name: 'Acme' }) }) })),
  }

  beforeEach(() => Company.findOne.mockClear())

  test('requires a real tenant company for company-scoped devices', async () => {
    const invalid = await validateMachineInput({
      name: 'Gate one', providerKey: 'zkteco', model: 'K40', scope: 'company',
      companyId: '', connectionMode: 'push_http', duplicateWindowSeconds: 30,
    }, { Company })
    expect(invalid.valid).toBe(false)
    expect(invalid.errors).toContain('Select a company for a company-scoped machine')
  })

  test('accepts a Vercel-compatible LAN bridge without weakening tenant scope', async () => {
    const valid = await validateMachineInput({
      name: 'Factory reader', providerKey: 'zkteco', model: 'SpeedFace', scope: 'company',
      companyId: '507f1f77bcf86cd799439011', connectionMode: 'lan_bridge', host: '192.168.1.40',
      port: 4370, duplicateWindowSeconds: 30, punchDirectionMode: 'first_last',
    }, { Company })
    expect(valid.valid).toBe(true)
    expect(valid.data.company.toString()).toBe('507f1f77bcf86cd799439011')
    expect(valid.data.timezone).toBe('Asia/Kolkata')
  })

  test('rejects insecure cloud endpoints', async () => {
    const result = await validateMachineInput({
      name: 'Cloud reader', providerKey: 'anviz', model: 'CrossChex Cloud', scope: 'organisation',
      connectionMode: 'cloud_api', endpointUrl: 'http://vendor.example', duplicateWindowSeconds: 30,
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Vendor cloud endpoints must use HTTPS')
  })
})

describe('attendance machine ingestion normalization', () => {
  const machine = {
    _id: 'machine-id', timezone: 'Asia/Kolkata', duplicateWindowSeconds: 30,
    employeeCodeField: 'staffNumber',
  }

  test('normalizes custom employee fields and naive machine times as IST', () => {
    const result = normalizeMachinePunch({
      staffNumber: 'EMP-7', eventTime: '2026-08-31 09:15:00', type: 'entry', id: 'evt-1',
    }, machine)
    expect(result.valid).toBe(true)
    expect(result.employeeCode).toBe('EMP-7')
    expect(result.direction).toBe('in')
    expect(result.punchedAt.toISOString()).toBe('2026-08-31T03:45:00.000Z')
  })

  test('extracts common vendor envelope shapes and creates deterministic dedupe keys', () => {
    const records = extractMachineRecords({ events: [{ uid: '1', timestamp: '2026-08-31T04:00:00Z' }] })
    expect(records).toHaveLength(1)
    const first = normalizeMachinePunch(records[0], machine)
    const second = normalizeMachinePunch(records[0], machine)
    expect(first.eventKey).toBe(second.eventKey)
  })
})

describe('attendance machine setup tokens', () => {
  test('stores and verifies only a deterministic hash', () => {
    const token = createMachineToken()
    const hash = hashMachineToken(token)
    expect(hash).not.toContain(token)
    expect(verifyMachineToken(token, hash)).toBe(true)
    expect(verifyMachineToken(`${token}x`, hash)).toBe(false)
  })
})

describe('attendance machine CSV imports', () => {
  test('parses quoted vendor exports and common snake-case headers', () => {
    const records = parseAttendanceCsv('employee_code,event_time,direction,site\n"EMP,7",2026-08-31 09:00:00,in,"HQ, Gate 1"\n')
    expect(records).toEqual([{
      employee_code: 'EMP,7',
      event_time: '2026-08-31 09:00:00',
      direction: 'in',
      site: 'HQ, Gate 1',
    }])
  })
})

