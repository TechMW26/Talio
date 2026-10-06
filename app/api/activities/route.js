import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { activityContext } from '@/lib/platform/firestoreActivity.server'
import { attendanceError, attendanceId } from '@/lib/platform/firestoreAttendance.server'
import { getAttendanceDayRange } from '@/lib/attendanceAutoCheckout'
export async function GET(request) {
  try {
    const {database,user}=await activityContext(request),params=new URL(request.url).searchParams
    const account=await database.get('users',attendanceId(user._id||user.userId))
    if(!account?.employeeId) return NextResponse.json({success:true,data:[],count:0,message:'No employee profile linked'})
    const date=params.get('date')||new Date()
    if(Number.isNaN(+new Date(date))) throw attendanceError('Invalid date')
    const range=getAttendanceDayRange(date,'Asia/Kolkata')
    const filters=[{field:'employee',operator:'==',value:attendanceId(account.employeeId)},{field:'createdAt',operator:'>=',value:range.start},{field:'createdAt',operator:'<=',value:range.end}]
    if(params.get('type')) filters.push({field:'type',operator:'==',value:params.get('type')})
    const data=(await database.list('activities',{filters,orderBy:[{field:'createdAt',direction:'desc'}],limit:Math.min(100,Math.max(1,Number(params.get('limit'))||50))})).records
    return NextResponse.json({success:true,data,count:data.length})
  } catch(error){return NextResponse.json({success:false,message:error.message},{status:error.status||500})}
}
export async function POST(request) {
  try {
    const {database,user}=await activityContext(request),input=await request.json()
    const account=await database.get('users',attendanceId(user._id||user.userId))
    if(!account?.employeeId) throw attendanceError('No employee profile linked')
    if(typeof input.type!=='string'||!input.type.trim()||input.type.length>100||typeof input.action!=='string'||!input.action.trim()||input.action.length>500) throw attendanceError('A valid activity type and action are required')
    if(input.details&&String(input.details).length>10000||JSON.stringify(input.metadata||{}).length>20000) throw attendanceError('Activity details exceed the allowed size')
    if(input.relatedId&&!/^[a-f0-9]{24}$/.test(input.relatedId)) throw attendanceError('Invalid related record ID')
    const now=new Date()
    const data={_id:randomBytes(12).toString('hex'),employee:attendanceId(account.employeeId),type:input.type,action:input.action,details:String(input.details||''),metadata:input.metadata||{},relatedModel:input.relatedModel?String(input.relatedModel).slice(0,100):null,relatedId:input.relatedId||null,ipAddress:request.headers.get('x-forwarded-for')?.split(',')[0]||request.headers.get('x-real-ip'),userAgent:request.headers.get('user-agent'),createdAt:now,updatedAt:now}
    await database.create('activities',data)
    return NextResponse.json({success:true,data},{status:201})
  } catch(error){return NextResponse.json({success:false,message:error.message},{status:error.status||500})}
}

