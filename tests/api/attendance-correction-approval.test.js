import { randomBytes } from 'node:crypto'
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { ATTENDANCE_DATABASE_OPTIONS, attendanceKey } from '@/lib/platform/firestoreAttendance.server'
import { submitAttendanceCorrection, reviewAttendanceCorrection } from '@/lib/platform/firestoreAttendanceCorrections.server'
import { saveAttendancePunch } from '@/lib/platform/firestoreAttendancePunch.server'
import { recoverAttendanceDay } from '@/lib/attendanceNotificationScheduler'
import { getStartOfDayInTimezone } from '@/lib/timezone'
jest.mock('@/lib/platform/firestoreBackgroundJobs.server',()=>({enqueueBackgroundJob:jest.fn()}))
jest.mock('@/lib/platform/firestoreApplication.server',()=>({getFirestoreTenantDatabase:jest.fn(),getFirestoreSystemDatabase:jest.fn()}))
jest.mock('@/lib/pushNotification',()=>({sendPushToUser:jest.fn()}))
const emulator=process.env.TALIO_FIRESTORE_EMULATOR_TEST==='1'?describe:describe.skip
jest.setTimeout(30000)
emulator('native attendance corrections and punches',()=>{
 let firestore,database
 const employeeId='6957b35cbf0b9ea49ca507a3',userId='6957b35cbf0b9ea49ca507a5',reviewerId='6957b35cbf0b9ea49ca507a4',adminId='6957b35cbf0b9ea49ca507a6'
 const date=getStartOfDayInTimezone('2026-09-03','Asia/Kolkata'),actor={_id:userId,employeeId},admin={_id:adminId,employeeId:reviewerId,role:'admin'}
 const input={date:'2026-09-03',correctionType:'missing-entry',requestedCheckIn:'2026-09-03T09:00:00',requestedCheckOut:'2026-09-03T18:00:00',reason:'Correct shift timings'}
 beforeAll(()=>{if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185')throw new Error('Isolated emulator required');firestore=new Firestore({projectId:'demo-talio-firestore'})})
 afterAll(()=>firestore.terminate())
 beforeEach(async()=>{
  database=createFirestoreDatabase({firestore,dataset:'test-correction-'+randomBytes(8).toString('hex'),databaseName:'talio_company_correction_test',...ATTENDANCE_DATABASE_OPTIONS})
  await database.create('companysettings',{_id:'settings',timezone:'Asia/Kolkata',checkOutTime:'18:00',fullDayHours:8,breakTimings:[]})
  await database.create('employees',{_id:employeeId,userId,status:'active'})
  await database.create('employees',{_id:reviewerId,userId:adminId,status:'active'})
  await database.create('users',{_id:userId,employeeId,role:'employee'})
  await database.create('users',{_id:adminId,employeeId:reviewerId,role:'admin'})
 })
 test('concurrent missing entry submissions create one placeholder and one pending request',async()=>{
  const attempts=await Promise.allSettled([submitAttendanceCorrection(database,actor,input),submitAttendanceCorrection(database,actor,input)])
  expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1)
  expect(await database.count('attendancecorrections')).toBe(1)
  expect(await database.count('attendances')).toBe(1)
 })
 test('approval atomically corrects legacy auto-checkout values and duplicate review is rejected',async()=>{
  const request=await submitAttendanceCorrection(database,actor,input)
  await database.mutate('attendances',request.attendance,r=>({...r,autoCheckedOut:true,autoCheckoutReason:'Midnight auto-checkout (Asia/Kolkata)',autoCheckoutAt:new Date()}))
  const result=await reviewAttendanceCorrection(database,admin,{correctionId:request._id,action:'approve'})
  expect(result.attendance).toMatchObject({status:'present',workHours:9,autoCheckedOut:false,autoCheckoutReason:null,autoCheckoutAt:null})
  expect(result.attendance.checkIn.toISOString()).toBe('2026-09-03T03:30:00.000Z')
  expect(result.correction.appliedStatus).toBe('present')
  await expect(reviewAttendanceCorrection(database,admin,{correctionId:request._id,action:'approve'})).rejects.toMatchObject({status:409})
 })
 test('check-in-only correction stays in progress and employee cannot self-approve',async()=>{
  const request=await submitAttendanceCorrection(database,actor,{...input,requestedCheckOut:undefined})
  await expect(reviewAttendanceCorrection(database,actor,{correctionId:request._id,action:'approve'})).rejects.toMatchObject({status:403})
  const result=await reviewAttendanceCorrection(database,admin,{correctionId:request._id,action:'approve'})
  expect(result.attendance).toMatchObject({status:'in-progress',workHours:0,checkOut:null})
 })
 test('correction cannot reference another employee attendance',async()=>{
  const id='6957b35cbf0b9ea49ca507a7'
  await database.create('attendances',{_id:id,employee:reviewerId,date,status:'absent'})
  await expect(submitAttendanceCorrection(database,actor,{...input,attendanceId:id})).rejects.toMatchObject({status:404})
  expect(await database.count('attendancecorrections')).toBe(0)
 })
 test('simultaneous user check-ins share canonical day and checkout detects intervening correction',async()=>{
  const args={employeeId,date,timezone:'Asia/Kolkata',type:'clock-in',changes:{checkIn:new Date('2026-09-03T03:30:00Z'),status:'in-progress','location.checkIn':{latitude:0,longitude:0}}}
  const attempts=await Promise.allSettled([saveAttendancePunch(database,args),saveAttendancePunch(database,args)])
  expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1)
  expect(await database.count('attendances')).toBe(1)
  const current=await database.get('attendances',attendanceKey(employeeId,date))
  expect(current.location.checkIn.latitude).toBe(0)
  await database.mutate('attendances',current._id,r=>({...r,checkIn:new Date('2026-09-03T04:30:00Z')}))
  await expect(saveAttendancePunch(database,{...args,type:'clock-out',changes:{checkOut:new Date('2026-09-03T12:30:00Z')},expected:current})).rejects.toMatchObject({status:409})
 })
 test('recovery preserves human corrections and uses the enum code for midnight checkout',async()=>{
  await database.create('attendances',{_id:'open',employee:employeeId,date,checkIn:new Date('2026-09-03T03:30:00Z'),status:'in-progress'})
  const preview=await recoverAttendanceDay(database,'2026-09-03',{dryRun:true})
  expect(preview.processed).toBe(1)
  expect((await database.get('attendances','open')).checkOut).toBeUndefined()
  const result=await recoverAttendanceDay(database,'2026-09-03')
  expect(result.processed).toBe(1)
  expect((await database.get('attendances','open')).autoCheckoutReason).toBe('midnight_cutoff')
  await database.mutate('attendances','open',r=>({...r,source:'correction',workHours:3,status:'present'}))
  expect((await recoverAttendanceDay(database,'2026-09-03')).rectified).toBe(0)
 })
})
