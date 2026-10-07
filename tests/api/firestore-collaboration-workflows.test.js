import {randomBytes} from 'node:crypto'
import {Firestore} from 'firebase-admin/firestore'
import {createFirestoreDatabase} from '@/lib/platform/firestoreStore.server'
import {IDEAS_DATABASE_OPTIONS,createIdea,mutateIdea,formatIdea,listIdeas} from '@/lib/platform/firestoreIdeas.server'
import {DAILY_GOALS_DATABASE_OPTIONS,saveDailyGoals,updateDailyGoal,summarizeDailyGoals} from '@/lib/platform/firestoreDailyGoals.server'
jest.mock('@/lib/auth',()=>({getAuthAndDatabase:jest.fn()}))
jest.mock('@/lib/platform/firestoreApplication.server',()=>({getFirestoreTenantDatabase:jest.fn()}))
jest.mock('@/lib/platform/firestoreBackgroundJobs.server',()=>({enqueueBackgroundJob:jest.fn()}))
jest.mock('@/lib/realtimeEvents',()=>({emitRealtimeEvent:jest.fn(()=>false)}))
const emulator=process.env.TALIO_FIRESTORE_EMULATOR_TEST==='1'?describe:describe.skip
jest.setTimeout(30000)
test('empty and partial goals have finite summary scores',()=>{expect(summarizeDailyGoals([]).productivityScore).toBe(30);expect(summarizeDailyGoals([{completed:true},{status:'in_progress'}]).completionRate).toBe(50)})
emulator('native ideas and daily goals',()=>{
 let firestore,database
 const owner={_id:'111111111111111111111111',employeeId:'222222222222222222222222',role:'employee',isActive:true},other={_id:'333333333333333333333333',employeeId:'444444444444444444444444',role:'employee',isActive:true},admin={_id:'555555555555555555555555',employeeId:'666666666666666666666666',role:'admin',isActive:true}
 beforeAll(()=>{if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185')throw new Error('Isolated emulator required');firestore=new Firestore({projectId:'demo-talio-firestore'})})
 afterAll(()=>firestore.terminate())
 beforeEach(async()=>{
  const options={queryFields:{...IDEAS_DATABASE_OPTIONS.queryFields,...DAILY_GOALS_DATABASE_OPTIONS.queryFields},constraints:DAILY_GOALS_DATABASE_OPTIONS.constraints}
  database=createFirestoreDatabase({firestore,dataset:'test-collab-'+randomBytes(8).toString('hex'),databaseName:'talio_company_collab_test',...options})
  for(const user of[owner,other,admin]){await database.create('users',user);await database.create('employees',{_id:user.employeeId,userId:user._id,firstName:user.role,status:'active'})}
  await database.create('companysettings',{_id:'settings',timezone:'Asia/Kolkata'})
 })
 test('ideas vote and comment updates are atomic and anonymous author remains private',async()=>{
  const created=await createIdea(database,owner,{title:'Suggestion',description:'Improve workflow',isAnonymous:true})
  await Promise.all([mutateIdea(database,owner,created._id,'vote',{type:'upvote'}),mutateIdea(database,other,created._id,'vote',{type:'upvote'})])
  await Promise.all([mutateIdea(database,owner,created._id,'comment',{content:'First'}),mutateIdea(database,other,created._id,'comment',{content:'Second'})])
  const result=await formatIdea(database,await database.get('suggestions',created._id),other,{detail:true})
  expect(result).toMatchObject({likes:2,voteCount:2,author:null,submittedBy:null,commentsCount:2})
  await expect(mutateIdea(database,other,created._id,'update',{title:'Stolen'})).rejects.toMatchObject({status:403})
  await expect(mutateIdea(database,other,created._id,'vote',{type:'invalid'})).rejects.toMatchObject({status:400})
 })
 test('private ideas cannot be read by unrelated employee or browse listing',async()=>{
  const idea=await createIdea(database,owner,{title:'Private',description:'Private content'})
  await database.mutate('suggestions',idea._id,r=>({...r,isPublic:false}))
  await expect(formatIdea(database,await database.get('suggestions',idea._id),other)).rejects.toMatchObject({status:404})
  expect((await listIdeas(database,other,new URLSearchParams())).data).toEqual([])
 })
 test('concurrent daily goals create one record, ownership and locks enforced',async()=>{
  const input={date:'2026-09-01',goals:[{title:'Prepare report'}]}
  const records=await Promise.all([saveDailyGoals(database,owner,input),saveDailyGoals(database,owner,input)])
  expect(await database.count('dailygoals')).toBe(1);expect(records[0]._id).toBe(records[1]._id)
  await expect(saveDailyGoals(database,other,{...input,employeeId:owner.employeeId})).rejects.toMatchObject({status:403})
  const current=await database.get('dailygoals',records[0]._id)
  await database.mutate('dailygoals',current._id,r=>({...r,submissionStatus:{isLocked:true}}))
  await expect(updateDailyGoal(database,owner,{dailyGoalId:current._id,goalId:current.goals[0]._id,updateData:{completed:true}})).rejects.toMatchObject({status:403})
  expect(await updateDailyGoal(database,admin,{dailyGoalId:current._id,goalId:current.goals[0]._id,updateData:{completed:true}})).toMatchObject({summary:{completedGoals:1}})
 })
 test('manager review cannot be forged by owner',async()=>{
  const record=await saveDailyGoals(database,owner,{date:'2026-09-01',goals:[{title:'A'}]})
  await expect(updateDailyGoal(database,owner,{dailyGoalId:record._id,managerReview:{overallRating:5}})).rejects.toMatchObject({status:403})
 })
})
