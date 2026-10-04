import { randomBytes } from 'node:crypto'
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { HEALTH_DATABASE_OPTIONS, calculateNativeHealthScore, deriveHealthScore, visibleHealthEmployees } from '@/lib/platform/firestoreHealthScore.server'
import { manualCapturePermissions } from '@/lib/platform/firestoreActivity.server'
jest.mock('@/lib/auth',()=>({getAuthAndDatabase:jest.fn()}))
jest.mock('@/lib/platform/firestoreApplication.server',()=>({getFirestoreTenantDatabase:jest.fn()}))
const emulator=process.env.TALIO_FIRESTORE_EMULATOR_TEST==='1'?describe:describe.skip
jest.setTimeout(30000)
const ids={employee:'111111111111111111111111',user:'222222222222222222222222',admin:'333333333333333333333333',other:'444444444444444444444444',otherUser:'555555555555555555555555',head:'666666666666666666666666',headUser:'777777777777777777777777',department:'888888888888888888888888'}
test('health calculation preserves historical evidence and weights without duplicate warnings',()=>{
 const now=new Date('2026-10-01T12:00:00Z')
 const previous={employee:ids.employee,history:[{date:new Date('2020-01-01'),overallScore:100}],warnings:[{_id:'old',type:'attendance',message:'Earlier issue',acknowledged:true}],improvementPlan:{isActive:true}}
 const next=deriveHealthScore(previous,[{status:'absent'}],[{overallRating:2}],[{status:'rejected'}],now)
 expect(next).toMatchObject({attendanceScore:0,punctualityScore:100,performanceScore:40,leaveScore:90,overallScore:44,riskLevel:'critical',salaryDeductionRisk:true})
 expect(next.history[0]).toEqual(previous.history[0]);expect(next.warnings[0]).toEqual(previous.warnings[0])
 const replay=deriveHealthScore(next,[{status:'absent'}],[{overallRating:2}],[{status:'rejected'}],now)
 expect(replay.history).toHaveLength(next.history.length);expect(replay.warnings).toHaveLength(next.warnings.length)
})
emulator('native health and capture access',()=>{
 let firestore,database
 const now=new Date('2026-10-01T12:00:00Z')
 beforeAll(()=>{if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185')throw new Error('Isolated emulator required');firestore=new Firestore({projectId:'demo-talio-firestore'})})
 afterAll(()=>firestore.terminate())
 beforeEach(async()=>{
  database=createFirestoreDatabase({firestore,dataset:'test-health-'+randomBytes(8).toString('hex'),databaseName:'talio_company_health_test',...HEALTH_DATABASE_OPTIONS})
  await database.create('employees',{_id:ids.employee,firstName:'Employee',status:'active',userId:ids.user,department:ids.department})
  await database.create('employees',{_id:ids.other,firstName:'Other',status:'active',userId:ids.otherUser})
  await database.create('employees',{_id:ids.head,firstName:'Head',status:'active',userId:ids.headUser})
  await database.create('users',{_id:ids.user,employeeId:ids.employee,role:'employee',isActive:true})
  await database.create('users',{_id:ids.otherUser,employeeId:ids.other,role:'employee',isActive:true})
  await database.create('users',{_id:ids.headUser,employeeId:ids.head,role:'manager',isActive:true})
  await database.create('users',{_id:ids.admin,role:'admin',isActive:true})
  await database.create('departments',{_id:ids.department,name:'Support',head:ids.head,isActive:true})
 })
 test('concurrent first calculations create one score and reuse cached daily result',async()=>{
  await database.create('attendances',{_id:'attendance',employee:ids.employee,date:new Date('2026-09-29'),status:'present'})
  const results=await Promise.all([calculateNativeHealthScore(database,ids.employee,{now}),calculateNativeHealthScore(database,ids.employee,{now})])
  expect(results.filter(r=>r.updated)).toHaveLength(1);expect(await database.count('healthscores')).toBe(1)
  expect(results[0].record.overallScore).toBe(100)
 })
 test('recalculation keeps migrated score ID, mentor and acknowledgement',async()=>{
  await database.create('healthscores',{_id:'imported',employee:ids.employee,metrics:{lastCalculated:new Date('2020-01-01')},improvementPlan:{mentor:ids.head,isActive:true},warnings:[{_id:'warning',acknowledged:true,type:'attendance',message:'Original'}],history:[]})
  const {record}=await calculateNativeHealthScore(database,ids.employee,{now})
  expect(record._id).toBe('imported');expect(record.improvementPlan.mentor).toBe(ids.head);expect(record.warnings[0].acknowledged).toBe(true)
 })
 test('health visibility uses fresh role and linked employee not user ID',async()=>{
  expect((await visibleHealthEmployees(database,{_id:ids.user,role:'admin'})).map(e=>e._id)).toEqual([ids.employee])
  await expect(visibleHealthEmployees(database,{_id:ids.user,role:'employee'},ids.other)).rejects.toMatchObject({status:404})
 })
 test('department head can only target scoped non-protected accounts',async()=>{
  let result=await manualCapturePermissions(database,{_id:ids.headUser,role:'manager'})
  expect(result.permissions.canInitiateCapture).toBe(true);expect(result.targetableUsers.map(u=>u._id)).toEqual([ids.user])
  await database.mutate('users',ids.user,u=>({...u,role:'hr'}))
  result=await manualCapturePermissions(database,{_id:ids.headUser,role:'manager'})
  expect(result.targetableUsers).toEqual([])
 })
 test('regular employee cannot acquire capture permission from supplied role',async()=>{
  const result=await manualCapturePermissions(database,{_id:ids.otherUser,role:'admin'})
  expect(result.permissions.canInitiateCapture).toBe(false);expect(result.targetableUsers).toEqual([])
 })
 test('absent foreign employee has no health score writes',async()=>{
  await expect(calculateNativeHealthScore(database,'aaaaaaaaaaaaaaaaaaaaaaaa',{now})).rejects.toMatchObject({status:404})
  expect(await database.count('healthscores')).toBe(0)
 })
})
