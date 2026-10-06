import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ATTENDANCE_DATABASE_OPTIONS, attendanceId } from '@/lib/platform/firestoreAttendance.server'
import { resolveAttendanceCalendar } from '@/lib/services/attendanceAbsenceService.server'
import { getAttendanceDayRange } from '@/lib/attendanceAutoCheckout'
export const dynamic='force-dynamic'
export const runtime='nodejs'
const headers={'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate'}
export async function GET(request){
 try{
  const auth=await getAuthAndDatabase(request,ATTENDANCE_DATABASE_OPTIONS)
  if(!auth.success)return NextResponse.json({error:auth.message},{status:401,headers})
  const account=await auth.database.get('users',attendanceId(auth.user._id||auth.user.userId))
  const employee=account?.employeeId?await auth.database.get('employees',attendanceId(account.employeeId)):null
  if(!employee)return NextResponse.json({success:true,isClockedIn:false,reason:'No employee profile linked'},{headers})
  const calendar=await resolveAttendanceCalendar(auth.database,attendanceId(employee.company))
  const range=getAttendanceDayRange(new Date(),calendar.timezone)
  const records=(await auth.database.list('attendances',{filters:[{field:'employee',operator:'==',value:employee._id},{field:'date',operator:'>=',value:range.start},{field:'date',operator:'<=',value:range.end}],limit:2})).records
  if(records.length>1)return NextResponse.json({success:false,isClockedIn:false,error:'Duplicate attendance requires reconciliation'},{status:409,headers})
  const attendance=records[0]
  return NextResponse.json({success:true,isClockedIn:Boolean(attendance?.checkIn&&!attendance.checkOut),status:attendance?.status||null,checkIn:attendance?.checkIn||null,checkOut:attendance?.checkOut||null,userId:account._id},{headers})
 }catch(error){return NextResponse.json({success:false,error:'Failed to check clock status'},{status:500,headers})}
}
