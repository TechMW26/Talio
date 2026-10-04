import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { activityContext, manualCapturePermissions } from '@/lib/platform/firestoreActivity.server'
import { attendanceError } from '@/lib/platform/firestoreAttendance.server'
import { emitRealtimeEvent } from '@/lib/realtimeEvents'
export async function POST(request) {
  try {
    const {database,user,tenant}=await activityContext(request)
    const {targetUserId}=await request.json()
    if(!/^[a-f0-9]{24}$/.test(targetUserId||'')) throw attendanceError('Invalid target user ID')
    const {permissions,targetableUsers,scope}=await manualCapturePermissions(database,user)
    const target=targetableUsers.find(u=>u._id===targetUserId)
    if(!permissions.canInitiateCapture||!target) throw attendanceError('You cannot capture this user',403)
    const captureRequest={requestId:'mcr_'+randomUUID(),targetUserId,targetUserName:target.name,initiatorId:scope.current._id,initiatorRole:scope.current.role,requestedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()}
    const sent=process.env.TALIO_LOCAL_ACCEPTANCE!=='1' && emitRealtimeEvent('manual-capture-request',captureRequest,{userIds:[targetUserId],databaseName:tenant.databaseName})
    if(!sent) return NextResponse.json({success:false,error:'Desktop capture delivery is unavailable; no capture was requested'},{status:503})
    return NextResponse.json({success:true,message:'Manual capture request sent',request:captureRequest})
  } catch(error){return NextResponse.json({success:false,error:error.message},{status:error.status||500})}
}
export async function GET(request) {
  try {
    const {database,user}=await activityContext(request)
    const {permissions,targetableUsers}=await manualCapturePermissions(database,user)
    return NextResponse.json({success:true,permissions,targetableUsers})
  } catch(error){return NextResponse.json({success:false,error:error.message},{status:error.status||500})}
}
