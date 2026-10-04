import { createHash } from 'node:crypto'
import { getAuthAndDatabase } from '@/lib/auth'
import { getProductivityVisibility, queryProductivityByIds, populateProductivityEmployees } from './firestoreProductivityView.server'
import { attendanceId, attendanceError } from './firestoreAttendance.server'
import { ACTIVITY_DATABASE_OPTIONS } from './firestoreActivity.server'
export const HEALTH_DATABASE_OPTIONS={queryFields:{...ACTIVITY_DATABASE_OPTIONS.queryFields,healthscores:['employee','overallScore'],attendances:['employee','date'],performances:['employee','createdAt'],leaves:['employee','createdAt','status']},constraints:{healthscores:[{fields:['employee']}]}}
export async function healthContext(request,write=false){
 const auth=await getAuthAndDatabase(request,HEALTH_DATABASE_OPTIONS)
 if(!auth.success) throw attendanceError(auth.message||'Unauthorized',401)
 const current=await auth.database.get('users',attendanceId(auth.user._id||auth.user.userId))
 if(!current) throw attendanceError('User not found',401)
 if(write&&!['admin','hr','owner','superadmin','super_admin'].includes(current.role)) throw attendanceError('Insufficient permissions',403)
 return {...auth,user:current}
}
export async function visibleHealthEmployees(database,user,employeeId){
 if(employeeId&&!/^[a-f0-9]{24}$/.test(employeeId)) throw attendanceError('Invalid employee ID')
 const scope=await getProductivityVisibility(database,user,{includeSelf:true})
 if(employeeId&&!scope.employees.some(e=>e._id===employeeId)) throw attendanceError('Employee not found',404)
 return employeeId?scope.employees.filter(e=>e._id===employeeId):scope.employees
}
export async function readHealthScores(database,employees){
 const records=await queryProductivityByIds(database,'healthscores','employee',employees.map(e=>e._id))
 const populated=await populateProductivityEmployees(database,employees),map=new Map(populated.map(e=>[e._id,e]))
 return Promise.all(records.sort((a,b)=>a.overallScore-b.overallScore).map(async r=>{
  const e=map.get(attendanceId(r.employee)),mentor=r.improvementPlan?.mentor?await database.get('employees',attendanceId(r.improvementPlan.mentor)):null
  return {...r,employee:e?{_id:e._id,firstName:e.firstName,lastName:e.lastName,employeeCode:e.employeeCode,department:e.department?{_id:e.department._id,name:e.department.name}:null,designation:e.designation?{_id:e.designation._id,title:e.designation.title}:null}:null,improvementPlan:{...r.improvementPlan,...(mentor?{mentor:{_id:mentor._id,firstName:mentor.firstName,lastName:mentor.lastName}}:{})}}
 }))
}
const stableId=value=>createHash('sha256').update(value).digest('hex').slice(0,24)
export function deriveHealthScore(current,attendanceRecords,performanceRecords,leaves,now=new Date()){
 const attendance={totalDays:attendanceRecords.length,presentDays:0,absentDays:0,lateDays:0,halfDays:0}
 for(const r of attendanceRecords){const key={'present':'presentDays','absent':'absentDays','late':'lateDays','half-day':'halfDays'}[r.status];if(key)attendance[key]++}
 const attendanceRate=attendance.totalDays?((attendance.presentDays+attendance.lateDays+attendance.halfDays)/attendance.totalDays)*100:100
 const punctualityRate=attendance.totalDays?((attendance.totalDays-attendance.lateDays)/attendance.totalDays)*100:100
 const ratings=performanceRecords.filter(r=>Number.isFinite(Number(r.overallRating))).slice(0,3)
 const averagePerformanceRating=ratings.length?ratings.reduce((n,r)=>n+Number(r.overallRating),0)/ratings.length:Number(current.metrics?.averagePerformanceRating||5)
 const unapprovedLeaves=leaves.filter(l=>l.status==='rejected').length
 const next={...current,attendanceScore:Math.max(0,attendanceRate-attendance.absentDays*2),punctualityScore:Math.max(0,punctualityRate-attendance.lateDays*1.5),performanceScore:ratings.length?Math.max(0,Math.min(100,averagePerformanceRating/5*100)):current.performanceScore??100,leaveScore:Math.max(0,100-unapprovedLeaves*10),metrics:{...current.metrics,totalWorkingDays:attendance.totalDays,presentDays:attendance.presentDays,absentDays:attendance.absentDays,lateDays:attendance.lateDays,halfDays:attendance.halfDays,attendanceRate,punctualityRate,averagePerformanceRating,unapprovedLeaves,lastCalculated:now},updatedAt:now}
 next.overallScore=Math.round(next.attendanceScore*.4+next.punctualityScore*.25+next.performanceScore*.25+next.leaveScore*.1)
 next.riskLevel=next.overallScore>=90?'low':next.overallScore>=75?'medium':next.overallScore>=60?'high':'critical'
 next.salaryDeductionRisk=next.overallScore<70||next.attendanceScore<75||next.punctualityScore<70
 next.warnings=[...(current.warnings||[])]
 const warning=(type,message,severity)=>{if(!next.warnings.some(w=>w.type===type&&w.message===message&&!w.acknowledged))next.warnings.push({_id:stableId(current.employee+type+message+now.toISOString()),type,message,severity,date:now,acknowledged:false})}
 if(next.attendanceScore<80)warning('attendance','Low attendance rate: '+attendanceRate.toFixed(1)+'%',next.attendanceScore<60?'high':'medium')
 if(next.punctualityScore<75)warning('punctuality','Frequent late arrivals: '+attendance.lateDays+' days in last 3 months',next.punctualityScore<50?'high':'medium')
 if(next.performanceScore<70)warning('performance','Below average performance rating: '+averagePerformanceRating.toFixed(1)+'/5','medium')
 next.history=[...(current.history||[])]
 const history={date:now,overallScore:next.overallScore,attendanceScore:next.attendanceScore,punctualityScore:next.punctualityScore,performanceScore:next.performanceScore,leaveScore:next.leaveScore,notes:'Calculated on '+now.toISOString().slice(0,10)}
 // Preserve migrated historical entries; append one calculation per changed metric snapshot.
 const previous=next.history[next.history.length-1]
 if(!previous||['overallScore','attendanceScore','punctualityScore','performanceScore','leaveScore'].some(k=>previous[k]!==history[k])||new Date(previous.date).toISOString().slice(0,10)!==now.toISOString().slice(0,10))next.history.push(history)
 return next
}
export async function calculateNativeHealthScore(database,employeeId,{forceRecalculate=false,now=new Date()}={}){
 if(!/^[a-f0-9]{24}$/.test(employeeId))throw attendanceError('Invalid employee ID')
 const cutoff=new Date(now.getFullYear(),now.getMonth()-3,1)
 return database.transaction(async tx=>{
  const [employee,existing,guard]=await Promise.all([tx.get('employees',employeeId),tx.list('healthscores',{filters:[{field:'employee',operator:'==',value:employeeId}],limit:2,requireComplete:true}),tx.get('healthscoreguards',employeeId)])
  if(!employee)throw attendanceError('Employee not found',404)
  if(existing.records.length>1)throw attendanceError('Duplicate health scores require reconciliation',409)
  const current=existing.records[0]
  if(current&&!forceRecalculate&&current.metrics?.lastCalculated&&now-new Date(current.metrics.lastCalculated)<86400000)return {record:current,updated:false}
  const filters=[{field:'employee',operator:'==',value:employeeId}]
  const [attendance,performance,leaves]=await Promise.all([
   tx.list('attendances',{filters:[...filters,{field:'date',operator:'>=',value:cutoff},{field:'date',operator:'<=',value:now}],limit:1000,requireComplete:true}),
   tx.list('performances',{filters:[...filters,{field:'createdAt',operator:'>=',value:cutoff}],orderBy:[{field:'createdAt',direction:'desc'}],limit:3}),
   tx.list('leaves',{filters:[...filters,{field:'createdAt',operator:'>=',value:cutoff},{field:'status',operator:'in',value:['approved','rejected']}],limit:1000,requireComplete:true}),
  ])
  const record=deriveHealthScore(current||{_id:stableId('health:'+employeeId),employee:employeeId,createdAt:now,improvementPlan:{isActive:false}},attendance.records,performance.records,leaves.records,now)
  const nextGuard={_id:employeeId,revision:Number(guard?.revision||0)+1,updatedAt:now}
  if(guard)await tx.replace('healthscoreguards',nextGuard);else await tx.create('healthscoreguards',nextGuard)
  if(current)await tx.replace('healthscores',record);else await tx.create('healthscores',record)
  return {record,updated:true}
 })
}
export async function bulkCalculateHealth(database,user,input={}){
 const employees=(await visibleHealthEmployees(database,user)).filter(e=>e.status==='active'&&(!input.department||attendanceId(e.department)===input.department)&&(!input.employeeIds?.length||input.employeeIds.includes(e._id)))
 if(input.employeeIds&&(!Array.isArray(input.employeeIds)||input.employeeIds.length>1000||input.employeeIds.some(id=>!/^[a-f0-9]{24}$/.test(id))))throw attendanceError('Invalid employee IDs')
 const results={processed:0,updated:0,errors:0,criticalCases:[],salaryDeductionRisks:[],departmentSummary:{},averageScore:0},scores=new Map()
 let total=0,count=0
 for(const employee of employees){results.processed++;try{
  const {record:r,updated}=await calculateNativeHealthScore(database,employee._id,{forceRecalculate:input.forceRecalculate===true})
  if(updated)results.updated++
  const identity={employeeId:employee._id,name:[employee.firstName,employee.lastName].filter(Boolean).join(' '),employeeCode:employee.employeeCode,score:r.overallScore,department:employee.department}
  if(r.riskLevel==='critical')results.criticalCases.push({...identity,riskLevel:r.riskLevel})
  if(r.salaryDeductionRisk)results.salaryDeductionRisks.push({...identity,attendanceScore:r.attendanceScore,punctualityScore:r.punctualityScore})
  const key=attendanceId(employee.department)||'unassigned',entry=scores.get(key)||{total:0,count:0,critical:0,risk:0,healthy:0}
  entry.total+=r.overallScore;entry.count++;entry.critical+=r.riskLevel==='critical'?1:0;entry.risk+=r.salaryDeductionRisk?1:0;entry.healthy+=r.riskLevel!=='critical'&&!r.salaryDeductionRisk?1:0;scores.set(key,entry)
  total+=r.overallScore;count++
 }catch{results.errors++}}
 for(const[key,s]of scores)results.departmentSummary[key]={averageScore:(s.total/s.count).toFixed(1),totalEmployees:s.count,criticalCases:s.critical,salaryRisks:s.risk,healthyEmployees:s.healthy}
 results.averageScore=count?(total/count).toFixed(1):0
 return results
}
