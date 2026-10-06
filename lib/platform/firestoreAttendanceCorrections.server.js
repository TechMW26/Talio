import { randomBytes } from 'node:crypto'
import { attendanceId, attendanceKey, attendanceError } from './firestoreAttendance.server'
import { getAttendanceDayRange } from '@/lib/attendanceAutoCheckout'
import { getTimezone, parseDateTimeInTimezone } from '@/lib/timezone'
import { finishAttendance } from '@/lib/attendanceNotificationScheduler'
import { isDirectReport } from '@/lib/teamScope'

const states = ['present','absent','half-day','late','on-leave','holiday','weekend','in-progress']
const validId = id => /^[a-f0-9]{24}$/.test(id || '')
async function correctionPolicy(reader, employee) {
  const [settings, company] = await Promise.all([reader.list('companysettings', { limit: 1 }), employee.company ? reader.get('companies', attendanceId(employee.company)) : null])
  const global = settings.records[0] || {}
  return { ...global, ...company?.workingHours, breakTimings: company?.breakTimings || global.breakTimings || [], timezone: getTimezone(company?.timezone || global.timezone) }
}
export async function submitAttendanceCorrection(database, actor, input) {
  if (input.attendanceId && !validId(input.attendanceId)) throw attendanceError('Invalid attendance ID')
  if (!input.attendanceId && (!input.date || Number.isNaN(+new Date(input.date)))) throw attendanceError('A valid attendance date is required')
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 10000 || !['check-in','check-out','both','status','missing-entry'].includes(input.correctionType)) throw attendanceError('A valid correction type and reason are required')
  if (input.requestedStatus && !states.includes(input.requestedStatus)) throw attendanceError('Invalid requested status')
  if (input.attachments && (!Array.isArray(input.attachments) || input.attachments.length > 20 || input.attachments.some(v => typeof v !== 'string' || v.length > 2000 || !/^(https:\/\/|\/api\/)/.test(v)))) throw attendanceError('Invalid correction attachments')
  const id = randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    const user = await tx.get('users', attendanceId(actor._id || actor.userId))
    const employee = user?.employeeId ? await tx.get('employees', attendanceId(user.employeeId)) : null
    if (!employee) throw attendanceError('Employee not found', 404)
    const settings = await correctionPolicy(tx, employee)
    let attendance = input.attendanceId ? await tx.get('attendances', input.attendanceId) : null
    if (input.attendanceId && (!attendance || attendanceId(attendance.employee) !== employee._id)) throw attendanceError('Attendance not found', 404)
    const range = getAttendanceDayRange(attendance?.date || input.date, settings.timezone)
    if (!range.start || Number.isNaN(+range.start)) throw attendanceError('Invalid attendance date')
    if (!attendance) {
      const day = await tx.list('attendances', { filters: [{ field:'employee',operator:'==',value:employee._id },{field:'date',operator:'>=',value:range.start},{field:'date',operator:'<=',value:range.end}],limit:2,requireComplete:true })
      if (day.records.length > 1) throw attendanceError('Duplicate attendance records require reconciliation',409)
      attendance = day.records[0] || null
    }
    if (!attendance && input.correctionType !== 'missing-entry') throw attendanceError('Attendance not found for this date',404)
    const attendanceRecordId = attendance?._id || attendanceKey(employee._id, range.start)
    const [pending, guard] = await Promise.all([
      tx.list('attendancecorrections',{filters:[{field:'attendance',operator:'==',value:attendanceRecordId},{field:'status',operator:'==',value:'pending'}],limit:2,requireComplete:true}),
      tx.get('attendancecorrectionguards',attendanceRecordId),
    ])
    if (pending.records.length) throw attendanceError('A pending correction request already exists for this date',409)
    const requested = {}
    for (const field of ['requestedCheckIn','requestedCheckOut']) if (input[field]) {
      requested[field] = parseDateTimeInTimezone(input[field],settings.timezone)
      if (!requested[field]) throw attendanceError('Invalid '+field)
    }
    const effectiveIn = requested.requestedCheckIn || attendance?.checkIn, effectiveOut = requested.requestedCheckOut || attendance?.checkOut
    if (effectiveOut && (!effectiveIn || effectiveOut <= effectiveIn)) throw attendanceError('Requested checkout must follow check-in')
    if (effectiveIn && effectiveOut && effectiveOut-effectiveIn > 48*3600000) throw attendanceError('Attendance cannot exceed 48 hours')
    const now = new Date()
    const record = { _id:id,employee:employee._id,attendance:attendanceRecordId,date:attendance?.date||range.start,
      currentCheckIn:attendance?.checkIn||null,currentCheckOut:attendance?.checkOut||null,currentStatus:attendance?.status||'absent',currentWorkHours:attendance?.workHours||0,
      correctionType:input.correctionType,...requested,...(input.requestedStatus?{requestedStatus:input.requestedStatus}:{}),reason:input.reason.trim(),attachments:input.attachments||[],status:'pending',createdAt:now,updatedAt:now }
    const nextGuard = {_id:attendanceRecordId,revision:Number(guard?.revision||0)+1,updatedAt:now}
    if (guard) await tx.replace('attendancecorrectionguards',nextGuard); else await tx.create('attendancecorrectionguards',nextGuard)
    if (!attendance) await tx.create('attendances',{_id:attendanceRecordId,employee:employee._id,date:range.start,status:'absent',isManualEntry:true,source:'manual_entry',createdAt:now,updatedAt:now})
    await tx.create('attendancecorrections',record)
    return record
  })
}
async function assertReviewer(tx, account, employee) {
  if (['admin','super_admin','superadmin','hr','owner'].includes(account?.role)) return
  const reviewerId = attendanceId(account?.employeeId)
  if (!reviewerId || !employee || reviewerId === employee._id) throw attendanceError('Insufficient permissions',403)
  const department = employee.department ? await tx.get('departments',attendanceId(employee.department)) : null
  if (attendanceId(department?.head)===reviewerId || (department?.heads||[]).some(id=>attendanceId(id)===reviewerId) || isDirectReport(employee,reviewerId)) return
  for (const id of account.teamLeaderOf || []) {
    const team = await tx.get('teams',attendanceId(id))
    if (team?.isActive !== false && [...(team?.members||[]),...(team?.teamLeaders||[])].some(id=>attendanceId(id)===employee._id)) return
  }
  throw attendanceError('Insufficient permissions',403)
}
export async function reviewAttendanceCorrection(database, actor, { correctionId, action, reviewerComments = '' }) {
  if (!validId(correctionId) || !['approve','reject'].includes(action) || typeof reviewerComments !== 'string' || reviewerComments.length>10000) throw attendanceError('Invalid correction review')
  return database.transaction(async tx => {
    const [correction,account] = await Promise.all([tx.get('attendancecorrections',correctionId),tx.get('users',attendanceId(actor._id||actor.userId))])
    if (!correction) throw attendanceError('Correction request not found',404)
    if (correction.status !== 'pending') throw attendanceError('This request has already been processed',409)
    const employee = await tx.get('employees',attendanceId(correction.employee))
    await assertReviewer(tx,account,employee)
    const attendance = await tx.get('attendances',attendanceId(correction.attendance))
    if (!attendance || attendanceId(attendance.employee)!==attendanceId(correction.employee)) throw attendanceError('Attendance record not found',404)
    const settings = await correctionPolicy(tx,employee)
    const now = new Date(), next = {...correction,status:action==='approve'?'approved':'rejected',reviewedBy:attendanceId(account.employeeId)||null,reviewedAt:now,reviewerComments,updatedAt:now}
    let updated
    if (action==='approve') {
      updated={...attendance,checkIn:correction.requestedCheckIn||attendance.checkIn||null,checkOut:correction.requestedCheckOut||attendance.checkOut||null}
      if (updated.checkOut && (!updated.checkIn || updated.checkOut<=updated.checkIn)) throw attendanceError('Corrected checkout must follow check-in')
      if (updated.checkIn && updated.checkOut) updated=finishAttendance(updated,updated.checkOut,settings)
      else updated={...updated,status:correction.requestedStatus||(updated.checkIn?'in-progress':'absent'),workHours:0,totalLoggedHours:0,breakMinutes:0,shrinkagePercentage:0,statusReason:updated.checkIn?'Check-in recorded; checkout is still pending':'Manual status set (no check-in/out times)'}
      updated={...updated,statusReason:'Corrected: '+updated.statusReason,isManualEntry:true,source:'correction',remarks:'Corrected on '+now.toLocaleDateString('en-IN')+' - '+correction.reason,createdBySystem:false,lastModifiedBy:account._id,approvedBy:attendanceId(account.employeeId)||null,checkOutStatus:updated.checkOut?'on-time':null,autoCheckedOut:false,autoCheckoutReason:null,autoCheckoutAt:null,correctedAt:now,updatedAt:now}
      Object.assign(next,{appliedCheckIn:updated.checkIn,appliedCheckOut:updated.checkOut,appliedStatus:updated.status,appliedWorkHours:updated.workHours})
      await tx.replace('attendances',updated)
    }
    await tx.replace('attendancecorrections',next)
    return {correction:next,...(updated?{attendance:updated}:{}),employeeId:attendanceId(correction.employee),recipientUserId:attendanceId(employee?.userId)||null}
  })
}
