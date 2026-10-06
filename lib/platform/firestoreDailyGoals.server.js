import { randomBytes,createHash } from 'node:crypto'
import { getAuthAndDatabase } from '@/lib/auth'
import { ACTIVITY_DATABASE_OPTIONS } from './firestoreActivity.server'
import { attendanceId,attendanceError } from './firestoreAttendance.server'
import { getProductivityVisibility,queryProductivityByIds } from './firestoreProductivityView.server'
import { getAttendanceDayRange } from '@/lib/attendanceAutoCheckout'
import { getTimezone,getDateKeyInTimezone,parseDateTimeInTimezone } from '@/lib/timezone'
import { isDirectReport } from '@/lib/teamScope'
import { enqueueBackgroundJob } from './firestoreBackgroundJobs.server'
export const DAILY_GOALS_DATABASE_OPTIONS={queryFields:{...ACTIVITY_DATABASE_OPTIONS.queryFields,dailygoals:['employee','date']}}
export const goalAdmin=user=>['admin','hr','owner','superadmin','super_admin'].includes(user?.role)
export async function dailyGoalContext(request){
 const auth=await getAuthAndDatabase(request,DAILY_GOALS_DATABASE_OPTIONS)
 if(!auth.success)throw attendanceError(auth.message,401)
 const user=await auth.database.get('users',attendanceId(auth.user._id||auth.user.userId))
 if(!user)throw attendanceError('User not found',401)
 return {...auth,user}
}
export async function goalCalendar(database,date=new Date()){
 if(!date||Number.isNaN(+new Date(date)))throw attendanceError('Invalid date')
 const settings=(await database.list('companysettings',{limit:1})).records[0]||{},timezone=getTimezone(settings.timezone),range=getAttendanceDayRange(date,timezone)
 return {...range,timezone,cutoff:parseDateTimeInTimezone(range.dateKey+'T18:45:00',timezone)}
}
export async function visibleGoalEmployees(database,user,employeeId){
 if(employeeId&&!/^[a-f0-9]{24}$/.test(employeeId))throw attendanceError('Invalid employee ID')
 const scope=await getProductivityVisibility(database,user,{includeSelf:true})
 if(employeeId&&!scope.employees.some(e=>e._id===employeeId))throw attendanceError('Employee not found',404)
 return employeeId?scope.employees.filter(e=>e._id===employeeId):scope.employees
}
async function authorize(tx,actor,employeeId){
 const account=await tx.get('users',actor._id),employee=await tx.get('employees',employeeId)
 if(!account||!employee)throw attendanceError('Employee not found',404)
 const own=attendanceId(account.employeeId)===employeeId
 if(own||goalAdmin(account))return {account,own,manager:goalAdmin(account)}
 const reviewer=attendanceId(account.employeeId)
 if(isDirectReport(employee,reviewer))return {account,own:false,manager:true}
 const ids=[employee.department,...(employee.departments||[])].map(attendanceId).filter(Boolean),visited=new Set()
 while(ids.length){const id=ids.pop();if(visited.has(id))continue;visited.add(id);if(visited.size>100)throw attendanceError('Department hierarchy exceeds supported scope',422);const d=await tx.get('departments',id);if(!d||d.isActive===false)continue;if([d.head,...(d.heads||[])].map(attendanceId).includes(reviewer))return {account,own:false,manager:true};if(d.parentDepartment)ids.push(attendanceId(d.parentDepartment))}
 for(const id of account.teamLeaderOf||[]){const team=await tx.get('teams',attendanceId(id));if(team?.isActive!==false&&(team?.members||[]).map(attendanceId).includes(employeeId))return {account,own:false,manager:true}}
 throw attendanceError('Not authorized for this employee',403)
}
export function summarizeDailyGoals(goals){
 const completed=goals.filter(g=>g.status==='completed'||g.completed===true).length,totalEstimatedHours=goals.reduce((n,g)=>n+Number(g.estimatedHours||0),0),totalActualHours=goals.reduce((n,g)=>n+Number(g.actualHours||0),0),completionRate=goals.length?completed/goals.length*100:0
 const efficiency=totalActualHours>0&&totalEstimatedHours>0?Math.min(100,totalEstimatedHours/totalActualHours*100):100
 return {totalGoals:goals.length,completedGoals:completed,inProgressGoals:goals.filter(g=>g.status==='in_progress').length,deferredGoals:goals.filter(g=>g.status==='deferred').length,completionRate,totalEstimatedHours,totalActualHours,productivityScore:completionRate*.7+efficiency*.3}
}
function sanitizeGoal(input,current={},manager=false){
 const next={...current,_id:current._id||input._id||randomBytes(12).toString('hex'),createdAt:current.createdAt||new Date(),updatedAt:new Date()}
 if(!/^[a-f0-9]{24}$/.test(next._id))throw attendanceError('Invalid goal ID')
 for(const[field,max]of [['title',200],['description',500],['employeeRemarks',300],...(manager?[['managerRemarks',300]]:[])])if(input[field]!==undefined){if(typeof input[field]!=='string'||input[field].length>max)throw attendanceError('Invalid '+field);next[field]=input[field].trim()}
 if(!next.title)throw attendanceError('Goal title is required')
 for(const[field,values]of [['priority',['low','medium','high','urgent']],['category',['task','meeting','project','learning','admin','other']],['status',['not_started','in_progress','completed','cancelled','deferred']]])if(input[field]!==undefined){if(!values.includes(input[field]))throw attendanceError('Invalid '+field);next[field]=input[field]}
 for(const[field,max]of [['estimatedHours',24],['actualHours',24],['completionPercentage',100]])if(input[field]!==undefined){if(!Number.isFinite(Number(input[field]))||Number(input[field])<0||Number(input[field])>max)throw attendanceError('Invalid '+field);next[field]=Number(input[field])}
 if(input.completed!==undefined){if(typeof input.completed!=='boolean')throw attendanceError('Invalid completed flag');next.completed=input.completed;next.status=input.completed?'completed':'not_started'}
 next.status=next.status||'not_started';next.priority=next.priority||'medium'
 if(next.status==='completed'){next.completionPercentage=100;next.completed=true;next.endTime=next.endTime||new Date();next.completedAt=next.completedAt||new Date()}
 else if(next.status==='in_progress'&&!next.startTime)next.startTime=new Date()
 return next
}
const dayFilters=(employee,range)=>[{field:'employee',operator:'==',value:employee},{field:'date',operator:'>=',value:range.start},{field:'date',operator:'<=',value:range.end}]
const dayId=(employee,range)=>createHash('sha256').update('daily-goal:'+employee+':'+range.dateKey).digest('hex').slice(0,24)
export async function saveDailyGoals(database,user,input){
 const employeeId=input.employeeId||attendanceId(user.employeeId),range=await goalCalendar(database,input.date||new Date())
 if(!/^[a-f0-9]{24}$/.test(employeeId))throw attendanceError('Employee profile required')
 if(!Array.isArray(input.goals)||input.goals.length>100)throw attendanceError('Goals must be an array of at most 100 items')
 return database.transaction(async tx=>{
  const rights=await authorize(tx,user,employeeId),existing=await tx.list('dailygoals',{filters:dayFilters(employeeId,range),limit:2,requireComplete:true})
  if(existing.records.length>1)throw attendanceError('Duplicate daily goals require reconciliation',409)
  const current=existing.records[0],id=current?._id||dayId(employeeId,range),guard=await tx.get('dailygoalguards',dayId(employeeId,range)),now=new Date()
  if(current?.submissionStatus?.isLocked&&!rights.manager)throw attendanceError('Goals are locked and cannot be edited',403)
  const prior=new Map((current?.goals||[]).map(g=>[attendanceId(g._id),g]))
  const goals=input.goals.map(g=>sanitizeGoal(g,prior.get(attendanceId(g._id))||{},rights.manager))
  if(new Set(goals.map(g=>g._id)).size!==goals.length)throw attendanceError('Goal IDs must be unique')
  const isPastCutoff=range.dateKey===getDateKeyInTimezone(now,range.timezone)&&now>range.cutoff
  const next={...current,_id:id,employee:employeeId,date:current?.date||range.start,goals,summary:summarizeDailyGoals(goals),submissionStatus:{...current?.submissionStatus,...(isPastCutoff?{isLocked:true,lockedAt:now}:{})},createdAt:current?.createdAt||now,updatedAt:now}
  const nextGuard={_id:dayId(employeeId,range),revision:Number(guard?.revision||0)+1,updatedAt:now}
  if(guard)await tx.replace('dailygoalguards',nextGuard);else await tx.create('dailygoalguards',nextGuard)
  if(current)await tx.replace('dailygoals',next);else await tx.create('dailygoals',next)
  return next
 })
}
export async function updateDailyGoal(database,user,input){
 if(!/^[a-f0-9]{24}$/.test(input.dailyGoalId||''))throw attendanceError('Invalid daily goal ID')
 return database.transaction(async tx=>{
  const current=await tx.get('dailygoals',input.dailyGoalId)
  if(!current)throw attendanceError('Daily goal not found',404)
  const rights=await authorize(tx,user,attendanceId(current.employee)),now=new Date(),next={...current,updatedAt:now}
  if(input.goalId&&input.updateData){
   if(current.submissionStatus?.isLocked&&!rights.manager)throw attendanceError('Goals are locked and cannot be edited',403)
   if(!(current.goals||[]).some(g=>attendanceId(g._id)===input.goalId))throw attendanceError('Goal not found',404)
   next.goals=current.goals.map(g=>attendanceId(g._id)===input.goalId?sanitizeGoal(input.updateData,g,rights.manager):g);next.summary=summarizeDailyGoals(next.goals)
  }
  if(input.managerReview){if(!rights.manager)throw attendanceError('Manager review requires a scoped manager',403);const r=input.managerReview;if(r.overallRating!==undefined&&(!Number.isFinite(Number(r.overallRating))||r.overallRating<1||r.overallRating>5))throw attendanceError('Rating must be between 1 and 5');if(String(r.feedback||'').length>500||String(r.suggestions||'').length>500)throw attendanceError('Review text is too long');next.managerReview={reviewedBy:attendanceId(rights.account.employeeId)||null,reviewDate:now,feedback:String(r.feedback||''),suggestions:String(r.suggestions||''),...(r.overallRating!==undefined?{overallRating:Number(r.overallRating)}:{})}}
  await tx.replace('dailygoals',next);return next
 })
}
export async function listDailyGoals(database,user,params){
 const employees=await visibleGoalEmployees(database,user,params.get('employeeId')),range=await goalCalendar(database,params.get('date')||params.get('startDate')||new Date()),end=params.get('endDate')?(await goalCalendar(database,params.get('endDate'))).end:range.end
 if(end<range.start||end-range.start>366*86400000)throw attendanceError('Date range must be within one year')
 const records=await queryProductivityByIds(database,'dailygoals','employee',employees.map(e=>e._id),[{field:'date',operator:'>=',value:range.start},{field:'date',operator:'<=',value:end}]),map=new Map(employees.map(e=>[e._id,e]))
 return Promise.all(records.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(async r=>{const e=map.get(attendanceId(r.employee)),reviewer=r.managerReview?.reviewedBy?await database.get('employees',attendanceId(r.managerReview.reviewedBy)):null;return {...r,summary:r.summary||summarizeDailyGoals(r.goals||[]),employee:e?{_id:e._id,firstName:e.firstName,lastName:e.lastName,employeeCode:e.employeeCode,department:e.department,designation:e.designation}:null,managerReview:{...r.managerReview,...(reviewer?{reviewedBy:{_id:reviewer._id,firstName:reviewer.firstName,lastName:reviewer.lastName}}:{})}}}))
}
export async function remindDailyGoals(database,user,input){
 if(!goalAdmin(user))throw attendanceError('Insufficient permissions',403)
 if(!['morning','evening','cutoff','manager'].includes(input.reminderType))throw attendanceError('Invalid reminder type')
 if(input.employeeIds&&(!Array.isArray(input.employeeIds)||input.employeeIds.length>1000||input.employeeIds.some(id=>!/^[a-f0-9]{24}$/.test(id))))throw attendanceError('Invalid employee IDs')
 const employees=(await visibleGoalEmployees(database,user)).filter(e=>e.status==='active'&&(!input.employeeIds?.length||input.employeeIds.includes(e._id))),range=await goalCalendar(database),now=new Date(),result={processed:0,remindersSent:0,errors:0,reminderType:input.reminderType,details:[]}
 if(process.env.TALIO_LOCAL_ACCEPTANCE==='1')return {...result,suppressed:true}
 const flag={morning:'morningReminderSent',evening:'eveningReminderSent',cutoff:'cutoffReminderSent',manager:'managerNotificationSent'}[input.reminderType]
 for(const employee of employees){result.processed++;try{
  let message=''
  const rows=(await database.list('dailygoals',{filters:dayFilters(employee._id,range),limit:2})).records;if(rows.length>1)throw attendanceError('Duplicate goals',409)
  const goal=rows[0],pending=(goal?.goals||[]).filter(g=>!g.completed&&!['completed','cancelled'].includes(g.status)).length
  if(goal?.reminders?.[flag]||!employee.userId)continue
  if(input.reminderType==='morning'&&!goal?.goals?.length)message='Good morning '+employee.firstName+'! Please set your daily goals for today.'
  if(input.reminderType==='evening'&&pending)message='You have '+pending+' pending goals. Please update your progress.'
  if(input.reminderType==='cutoff'&&now>=range.cutoff&&(!goal?.goals?.length||pending))message='Daily goal cutoff has passed. Please review your outstanding goals.'
  if(input.reminderType==='manager'){
   const reports=employees.filter(e=>isDirectReport(e,employee._id));if(reports.length){const goals=await queryProductivityByIds(database,'dailygoals','employee',reports.map(e=>e._id),[{field:'date',operator:'>=',value:range.start},{field:'date',operator:'<=',value:range.end}]);message='Team Goals Summary: '+goals.length+'/'+reports.length+' members set goals.'}
  }
  if(!message)continue
  await enqueueBackgroundJob('notification',{databaseName:database.databaseName,userIds:[attendanceId(employee.userId)],title:'Daily goals reminder',message,url:'/dashboard/daily-goals',data:{type:'daily-goals',reminderType:input.reminderType}},{id:'daily-goals-'+dayId(employee._id,range)+'-'+input.reminderType})
  await database.transaction(async tx=>{
   const list=await tx.list('dailygoals',{filters:dayFilters(employee._id,range),limit:2,requireComplete:true}),current=list.records[0],id=current?._id||dayId(employee._id,range),guard=await tx.get('dailygoalguards',dayId(employee._id,range))
   if(list.records.length>1)throw attendanceError('Duplicate goals',409)
   const next={...current,_id:id,employee:employee._id,date:current?.date||range.start,goals:current?.goals||[],reminders:{...current?.reminders,[flag]:true},createdAt:current?.createdAt||now,updatedAt:now},nextGuard={_id:dayId(employee._id,range),revision:Number(guard?.revision||0)+1}
   if(guard)await tx.replace('dailygoalguards',nextGuard);else await tx.create('dailygoalguards',nextGuard)
   if(current)await tx.replace('dailygoals',next);else await tx.create('dailygoals',next)
  })
  result.remindersSent++;result.details.push({employeeId:employee._id,employeeName:[employee.firstName,employee.lastName].join(' '),message,sentAt:now})
 }catch{result.errors++}}
 return result
}
