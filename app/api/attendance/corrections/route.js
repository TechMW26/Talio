import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ATTENDANCE_DATABASE_OPTIONS, attendanceId, attendanceError } from '@/lib/platform/firestoreAttendance.server'
import { submitAttendanceCorrection, reviewAttendanceCorrection } from '@/lib/platform/firestoreAttendanceCorrections.server'
import { getProductivityVisibility, queryProductivityByIds } from '@/lib/platform/firestoreProductivityView.server'
import { emitEvent, EVENTS } from '@/lib/eventBus'
import queryCache from '@/lib/queryCache'
export const dynamic = 'force-dynamic'
const failure = error => NextResponse.json({success:false,message:error.message},{status:error.status||500})
async function context(request) {
  const auth=await getAuthAndDatabase(request,ATTENDANCE_DATABASE_OPTIONS)
  if(!auth.success) throw attendanceError(auth.message,401)
  return auth
}
export async function GET(request) {
  try {
    const {database,user}=await context(request),params=new URL(request.url).searchParams
    const type=params.get('type'), status=params.get('status'), employeeId=params.get('employeeId'), department=params.get('department'), teamId=params.get('team')
    if(employeeId&&!/^[a-f0-9]{24}$/.test(employeeId)) throw attendanceError('Invalid employee ID')
    if(status&&!['all','pending','approved','rejected'].includes(status)) throw attendanceError('Invalid status')
    const scope=await getProductivityVisibility(database,user,{includeSelf:true})
    let employees=scope.employees.filter(e=>(type!=='my'||e._id===attendanceId(user.employeeId))&&(!employeeId||e._id===employeeId)&&(!department||department==='all'||attendanceId(e.department)===department))
    if(teamId&&teamId!=='all') {
      const team=await database.get('teams',teamId),ids=new Set([...(team?.members||[]),...(team?.teamLeaders||[])].map(attendanceId))
      employees=employees.filter(e=>ids.has(e._id))
    }
    const employeeMap=new Map(employees.map(e=>[e._id,e]))
    const state=status&&status!=='all'?status:type==='pending'?'pending':null
    const records=await queryProductivityByIds(database,'attendancecorrections','employee',employees.map(e=>e._id),state?[{field:'status',operator:'==',value:state}]:[])
    const data=await Promise.all(records.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(async r=>{
      const e=employeeMap.get(r.employee),reviewer=r.reviewedBy?await database.get('employees',attendanceId(r.reviewedBy)):null
      const attendance=r.attendance?await database.get('attendances',attendanceId(r.attendance)):null
      return {...r,employee:e?{_id:e._id,firstName:e.firstName,lastName:e.lastName,employeeCode:e.employeeCode,profilePicture:e.profilePicture,department:e.department}:null,attendance:attendance?{_id:attendance._id,date:attendance.date,checkIn:attendance.checkIn,checkOut:attendance.checkOut,status:attendance.status,workHours:attendance.workHours}:null,reviewedBy:reviewer?{_id:reviewer._id,firstName:reviewer.firstName,lastName:reviewer.lastName}:null}
    }))
    return NextResponse.json({success:true,data})
  } catch(error){return failure(error)}
}
export async function POST(request) {
  try { const {database,user}=await context(request);return NextResponse.json({success:true,message:'Correction request submitted successfully',data:await submitAttendanceCorrection(database,user,await request.json())})}
  catch(error){return failure(error)}
}
export async function PATCH(request) {
  try {
    const {database,user,tenant}=await context(request),input=await request.json(),result=await reviewAttendanceCorrection(database,user,input)
    try { queryCache.clearPattern('attendance'); emitEvent(EVENTS.ATTENDANCE_CORRECTION_CHANGED,{correctionId:result.correction._id,action:result.correction.status,employeeId:result.employeeId,date:result.correction.date},{userIds:result.recipientUserId?[result.recipientUserId]:[],databaseName:tenant.databaseName}) } catch {}
    const {recipientUserId,...data}=result
    return NextResponse.json({success:true,message:input.action==='approve'?'Correction approved - Status: '+result.attendance.status+' ('+Number(result.attendance.workHours||0).toFixed(2)+'h worked)':'Correction request rejected',data})
  } catch(error){return failure(error)}
}
