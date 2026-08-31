import crypto from 'crypto'
import {
  DEFAULT_TIMEZONE,
  getStartOfDayInTimezone,
  parseDateTimeInTimezone,
} from '@/lib/timezone'
import { determineAttendanceStatus } from '@/lib/attendanceShrinkage'

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

async function applyPunchToAttendance({ Attendance, employee, punch, machine }) {
  const timezone = machine.timezone || DEFAULT_TIMEZONE
  let attendanceDate = getStartOfDayInTimezone(punch.punchedAt, timezone)
  let attendance = await Attendance.findOne({ employee: employee._id, date: attendanceDate })

  // An explicit OUT shortly after midnight belongs to the previous in-progress
  // shift. This keeps common overnight shifts on one attendance record.
  if (!attendance && punch.direction === 'out') {
    attendance = await Attendance.findOne({
      employee: employee._id,
      status: 'in-progress',
      checkIn: { $gte: new Date(punch.punchedAt.getTime() - (20 * 60 * 60 * 1000)), $lt: punch.punchedAt },
    }).sort({ checkIn: -1 })
    if (attendance) attendanceDate = attendance.date
  }

  if (!attendance) {
    attendance = new Attendance({
      employee: employee._id,
      date: attendanceDate,
      checkIn: punch.punchedAt,
      status: 'in-progress',
      source: 'attendance_machine',
      createdBySystem: true,
      isManualEntry: false,
      remarks: `Attendance machine: ${machine.name}`,
    })
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
  await attendance.save()
  return attendance
}

export async function ingestMachinePunches({ machine, payload, models }) {
  const { AttendanceMachinePunch, Attendance, Employee } = models
  const inputRecords = extractMachineRecords(payload).slice(0, 1000)
  const results = { received: inputRecords.length, processed: 0, duplicates: 0, unmapped: 0, rejected: 0, errors: [] }

  for (const record of inputRecords) {
    const punch = normalizeMachinePunch(record, machine)
    if (!punch.valid) {
      results.rejected += 1
      results.errors.push(punch.error)
      continue
    }

    const employeeQuery = { employeeCode: punch.employeeCode }
    if (machine.scope === 'company' && machine.company) employeeQuery.company = machine.company
    const employee = await Employee.findOne(employeeQuery)
      .select('_id company employeeCode')
      .populate('company', 'workingHours timezone')
      .lean()

    let punchDocument
    try {
      punchDocument = await AttendanceMachinePunch.create({
        machine: machine._id,
        eventKey: punch.eventKey,
        providerEventId: punch.providerEventId,
        employeeCode: punch.employeeCode,
        employee: employee?._id || null,
        company: employee?.company?._id || employee?.company || machine.company || null,
        punchedAt: punch.punchedAt,
        direction: punch.direction,
        verificationMode: punch.verificationMode,
        processingStatus: employee ? 'processed' : 'unmapped',
        processingError: employee ? null : 'No employee matched this code and machine scope',
        rawPayload: punch.rawPayload,
      })
    } catch (error) {
      if (error?.code === 11000) {
        results.duplicates += 1
        continue
      }
      throw error
    }

    if (!employee) {
      results.unmapped += 1
      continue
    }

    try {
      await applyPunchToAttendance({ Attendance, employee, punch, machine })
      results.processed += 1
    } catch (error) {
      punchDocument.processingStatus = 'rejected'
      punchDocument.processingError = String(error.message || 'Attendance processing failed').slice(0, 1000)
      await punchDocument.save()
      results.rejected += 1
      results.errors.push(punchDocument.processingError)
    }
  }

  return results
}
