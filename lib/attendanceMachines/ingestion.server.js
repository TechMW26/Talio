import crypto from 'crypto'
import {
  DEFAULT_TIMEZONE,
  getStartOfDayInTimezone,
  getEndOfDayInTimezone,
  parseDateTimeInTimezone,
} from '@/lib/timezone'
import { determineAttendanceStatus } from '@/lib/attendanceShrinkage'
import { attendanceKey, findAttendanceDay } from '@/lib/platform/firestoreAttendance.server'

const EMPLOYEE_CODE_KEYS = ['employeeCode', 'employee_code', 'userId', 'user_id', 'uid', 'pin', 'enrollNumber', 'enroll_number', 'personId', 'person_id']
const TIME_KEYS = ['punchedAt', 'punched_at', 'timestamp', 'dateTime', 'datetime', 'eventTime', 'event_time', 'attendanceTime', 'checkTime', 'check_time', 'time']
const EVENT_ID_KEYS = ['eventId', 'event_id', 'recordId', 'record_id', 'transactionId', 'transaction_id', 'id']
const DIRECTION_KEYS = ['direction', 'punchDirection', 'punch_direction', 'status', 'type', 'inOutMode', 'in_out_mode']

function firstValue(record, keys) {
  for (const key of keys) {
    if (record?.[key] !== undefined && record[key] !== null && record[key] !== '') return record[key]
  }
  return null
}

function normalizeDirection(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (['0', 'in', 'entry', 'checkin', 'check-in', 'clock-in', 'clock_in'].includes(normalized)) return 'in'
  if (['1', 'out', 'exit', 'checkout', 'check-out', 'clock-out', 'clock_out'].includes(normalized)) return 'out'
  return 'unknown'
}

function sanitizeRawPayload(value, depth = 0) {
  if (depth > 4) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeRawPayload(item, depth + 1))
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? value.slice(0, 2000) : value
  }
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, nested]) => {
    if (/password|secret|token|api.?key|authorization/i.test(key)) return [key, '[redacted]']
    return [key, sanitizeRawPayload(nested, depth + 1)]
  }))
}

export function extractMachineRecords(payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  for (const key of ['events', 'records', 'punches', 'attendance', 'data']) {
    if (Array.isArray(payload[key])) return payload[key]
  }
  return [payload]
}

export function normalizeMachinePunch(record, machine) {
  const employeeCodeKeys = machine.employeeCodeField
    ? [machine.employeeCodeField, ...EMPLOYEE_CODE_KEYS.filter((key) => key !== machine.employeeCodeField)]
    : EMPLOYEE_CODE_KEYS
  const employeeCode = String(firstValue(record, employeeCodeKeys) || '').trim()
  const rawTime = firstValue(record, TIME_KEYS)
  const punchedAt = parseDateTimeInTimezone(rawTime, machine.timezone || DEFAULT_TIMEZONE)
  if (!employeeCode) return { valid: false, error: 'Employee code is missing' }
  if (!punchedAt || Number.isNaN(punchedAt.getTime())) return { valid: false, error: 'Punch timestamp is invalid' }

  const direction = normalizeDirection(firstValue(record, DIRECTION_KEYS))
  const providerEventId = String(firstValue(record, EVENT_ID_KEYS) || '').trim()
  const windowMs = Math.max(1, Number(machine.duplicateWindowSeconds) || 30) * 1000
  const timeBucket = Math.floor(punchedAt.getTime() / windowMs)
  const eventKeySource = providerEventId
    ? `provider:${providerEventId}`
    : `${machine._id}:${employeeCode}:${timeBucket}:${direction}`

  return {
    valid: true,
    employeeCode,
    punchedAt,
    direction,
    providerEventId: providerEventId || null,
    verificationMode: String(record.verificationMode || record.verifyMode || record.verification_mode || '').slice(0, 100),
    eventKey: crypto.createHash('sha256').update(eventKeySource).digest('hex'),
    rawPayload: sanitizeRawPayload(record),
  }
}

export function applyMachinePunch({ attendance: existing, attendanceDate, employee, punch, machine }) {
  let attendance = existing ? { ...existing } : null
  if (!attendance) {
    attendance = {
      _id: attendanceKey(employee._id, attendanceDate),
      employee: employee._id,
      date: attendanceDate,
      checkIn: punch.punchedAt,
      status: 'in-progress',
      source: 'attendance_machine',
      createdBySystem: true,
      isManualEntry: false,
      remarks: `Attendance machine: ${machine.name}`,
      createdAt: new Date(),
    }
  } else if (!attendance.checkIn || punch.punchedAt < attendance.checkIn) {
    attendance.checkIn = punch.punchedAt
  }

  const interpretation = machine.punchDirectionMode || 'first_last'
  const canClose = interpretation === 'first_last'
    ? Boolean(attendance.checkIn && punch.punchedAt > attendance.checkIn)
    : interpretation === 'alternate'
      ? Boolean(attendance.checkIn && !attendance.checkOut && punch.punchedAt > attendance.checkIn)
      : punch.direction === 'out'
  if (canClose && punch.punchedAt > attendance.checkIn && (!attendance.checkOut || punch.punchedAt > attendance.checkOut)) {
    attendance.checkOut = punch.punchedAt
  }

  if (attendance.checkIn && attendance.checkOut) {
    const hours = Math.max(0, (attendance.checkOut.getTime() - attendance.checkIn.getTime()) / 3600000)
    attendance.workHours = Number(hours.toFixed(2))
    attendance.totalLoggedHours = attendance.workHours
    const statusResult = determineAttendanceStatus(attendance.workHours, {
      fullDayHours: employee.company?.workingHours?.fullDayHours || 8,
      halfDayHours: employee.company?.workingHours?.halfDayHours || 4,
    })
    attendance.status = statusResult.status
    attendance.statusReason = statusResult.reason
  } else {
    attendance.status = 'in-progress'
  }

  attendance.source = 'attendance_machine'
  attendance.createdBySystem = true
  attendance.updatedAt = new Date()
  return attendance
}

export async function ingestMachinePunches({ machine, payload, database }) {
  if (!database) throw new Error('Tenant database required')
  const inputRecords = extractMachineRecords(payload)
  if (inputRecords.length > 1000) throw new Error('Import up to 1,000 punches at a time')
  const results = { received: inputRecords.length, processed: 0, duplicates: 0, unmapped: 0, rejected: 0, errors: [] }

  for (const record of inputRecords) {
    const punch = normalizeMachinePunch(record, machine)
    if (!punch.valid) {
      results.rejected += 1
      results.errors.push(punch.error)
      continue
    }

    const employeeFilters = [{ field: 'employeeCode', operator: '==', value: punch.employeeCode }]
    if (machine.scope === 'company' && machine.company) employeeFilters.push({ field: 'company', operator: '==', value: String(machine.company) })
    const employees = (await database.list('employees', { filters: employeeFilters, limit: 2 })).records
    if (employees.length > 1) { results.rejected++; results.errors.push('Employee code is ambiguous in the machine scope'); continue }
    const employee = employees[0] || null
    const company = employee?.company ? await database.get('companies', String(employee.company)) : null
    const imported = (await database.list('attendancemachinepunches', { filters: [{ field: 'machine', operator: '==', value: String(machine._id) }, { field: 'eventKey', operator: '==', value: punch.eventKey }], limit: 1 })).records[0]
    if (imported) { results.duplicates++; continue }
    const punchId = crypto.createHash('sha256').update(`${machine._id}:${punch.eventKey}`).digest('hex').slice(0, 24)
    let attendanceDate = getStartOfDayInTimezone(punch.punchedAt, machine.timezone || DEFAULT_TIMEZONE)
    let existing = employee ? await findAttendanceDay(database, employee._id, attendanceDate, machine.timezone || DEFAULT_TIMEZONE) : null
    if (employee && !existing && punch.direction === 'out') {
      existing = (await database.list('attendances', { filters: [
        { field: 'employee', operator: '==', value: employee._id }, { field: 'status', operator: '==', value: 'in-progress' },
        { field: 'checkIn', operator: '>=', value: new Date(punch.punchedAt.getTime() - 20 * 3600000) }, { field: 'checkIn', operator: '<', value: punch.punchedAt },
      ], orderBy: [{ field: 'checkIn', direction: 'desc' }], limit: 1 })).records[0] || null
      if (existing) attendanceDate = existing.date
    }
    try {
      const outcome = await database.transaction(async tx => {
        const [savedPunch, currentMachine, currentEmployee, day] = await Promise.all([
          tx.get('attendancemachinepunches', punchId), tx.get('attendancemachines', String(machine._id)), employee ? tx.get('employees', employee._id) : null,
          employee ? tx.list('attendances', { filters: [{ field: 'employee', operator: '==', value: employee._id }, { field: 'date', operator: '>=', value: getStartOfDayInTimezone(attendanceDate, machine.timezone || DEFAULT_TIMEZONE) }, { field: 'date', operator: '<=', value: getEndOfDayInTimezone(attendanceDate, machine.timezone || DEFAULT_TIMEZONE) }], limit: 2, requireComplete: true }) : null,
        ])
        if (savedPunch) return 'duplicates'
        if (!currentMachine || currentMachine.status === 'disabled' || currentMachine.webhookTokenHash !== machine.webhookTokenHash) throw new Error('Machine configuration changed; retry with current credentials')
        if (day?.records.length > 1) throw new Error('Duplicate attendance records require reconciliation')
        if (employee && (!currentEmployee || currentEmployee.employeeCode !== punch.employeeCode || currentMachine.scope === 'company' && String(currentEmployee.company) !== String(currentMachine.company))) throw new Error('Employee scope changed; retry the punch')
        const attendance = day?.records[0] || null
        if (employee) {
          const next = applyMachinePunch({ attendance, attendanceDate, employee: { ...employee, company }, punch, machine: currentMachine })
          if (attendance) await tx.replace('attendances', next)
          else await tx.create('attendances', next)
        }
        await tx.create('attendancemachinepunches', {
        _id: punchId,
        machine: machine._id,
        eventKey: punch.eventKey,
        providerEventId: punch.providerEventId,
        employeeCode: punch.employeeCode,
        employee: employee?._id || null,
        company: employee?.company || machine.company || null,
        punchedAt: punch.punchedAt,
        direction: punch.direction,
        verificationMode: punch.verificationMode,
        processingStatus: employee ? 'processed' : 'unmapped',
        processingError: employee ? null : 'No employee matched this code and machine scope',
        rawPayload: punch.rawPayload,
        createdAt: new Date(), updatedAt: new Date(),
        })
        return employee ? 'processed' : 'unmapped'
      })
      results[outcome]++
    } catch (error) {
      results.rejected += 1
      results.errors.push(String(error.message || 'Attendance processing failed').slice(0, 1000))
    }
  }

  return results
}
