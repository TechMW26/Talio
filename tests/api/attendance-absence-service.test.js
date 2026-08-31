import {
  getDayName,
  isWorkingDay,
  processAbsenceDate,
} from '@/lib/services/attendanceAbsenceService.server'

function queryResult(value) {
  const query = {
    select: jest.fn(() => query),
    populate: jest.fn(() => query),
    lean: jest.fn(async () => value),
  }
  return query
}

function modelsFor({ employees = [], leaves = [], attendance = [], holiday = null, bulkResult = { upsertedCount: 0, upsertedIds: {} } } = {}) {
  return {
    Company: { findOne: jest.fn(() => queryResult({ timezone: 'Asia/Kolkata', workingHours: { workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] } })) },
    CompanySettings: { findOne: jest.fn(() => queryResult(null)) },
    Holiday: { findOne: jest.fn(() => queryResult(holiday)) },
    Employee: { find: jest.fn(() => queryResult(employees)) },
    Leave: { find: jest.fn(() => queryResult(leaves)) },
    Attendance: {
      find: jest.fn(() => queryResult(attendance)),
      bulkWrite: jest.fn(async () => bulkResult),
    },
  }
}

describe('shared attendance absence service', () => {
  test('calculates the working day in IST even near a UTC date boundary', () => {
    const sundayUtcButMondayIst = new Date('2026-08-30T20:00:00.000Z')
    expect(getDayName(sundayUtcButMondayIst)).toBe('monday')
    expect(isWorkingDay(sundayUtcButMondayIst, ['monday'])).toBe(true)
  })

  test('skips weekends before scanning all employee records', async () => {
    const models = modelsFor()
    const result = await processAbsenceDate({ models, date: new Date('2026-08-30T06:00:00.000Z') })
    expect(result).toMatchObject({ skipped: true, skipReason: 'weekend', marked: 0 })
    expect(models.Employee.find).not.toHaveBeenCalled()
    expect(models.Attendance.bulkWrite).not.toHaveBeenCalled()
  })

  test('uses sets for existing attendance and leave, then performs one bounded bulk write', async () => {
    const models = modelsFor({
      employees: [
        { _id: 'e1', userId: { _id: 'u1' }, firstName: 'Asha' },
        { _id: 'e2', userId: { _id: 'u2' }, firstName: 'Dev' },
        { _id: 'e3', userId: { _id: 'u3' }, firstName: 'Mira' },
      ],
      leaves: [{ employee: 'e2' }],
      attendance: [{ employee: 'e3' }],
      bulkResult: { upsertedCount: 1, upsertedIds: { 0: 'attendance1' } },
    })
    const result = await processAbsenceDate({ models, date: new Date('2026-08-31T06:00:00.000Z') })
    expect(result).toMatchObject({ marked: 1, onLeave: 1, hadAttendance: 1 })
    expect(models.Attendance.bulkWrite).toHaveBeenCalledTimes(1)
    expect(models.Attendance.bulkWrite.mock.calls[0][0]).toHaveLength(1)
  })

  test('dry run reports candidates without writing', async () => {
    const models = modelsFor({ employees: [{ _id: 'e1', userId: { _id: 'u1' } }] })
    const result = await processAbsenceDate({ models, date: new Date('2026-08-31T06:00:00.000Z'), dryRun: true })
    expect(result.marked).toBe(1)
    expect(models.Attendance.bulkWrite).not.toHaveBeenCalled()
  })
})
