import {NextResponse} from 'next/server'
import {callAlertContext,acknowledgeCallAlert} from '@/lib/platform/firestoreCallAlerts.server'
import {attendanceId} from '@/lib/platform/firestoreAttendance.server'
import {emitRealtimeEvent} from '@/lib/realtimeEvents'
export async function POST(request,{params}){try{
 const {database,user,tenant}=await callAlertContext(request),{id}=await params,record=await acknowledgeCallAlert(database,user,id,await request.json().catch(()=>({}))),receiver=record.receivers.find(r=>attendanceId(r.user)===user._id)
 if(process.env.TALIO_LOCAL_ACCEPTANCE!=='1')emitRealtimeEvent('call-alert-acknowledged',{alertId:id,acknowledgedBy:{userId:user._id,name:receiver.name},acknowledgedAt:receiver.acknowledgedAt,allAcknowledged:record.receivers.every(r=>r.acknowledged)},{userIds:[attendanceId(record.sender)],databaseName:tenant.databaseName})
 return NextResponse.json({success:true,message:'Alert acknowledged successfully',data:{alertId:id,acknowledged:true,acknowledgedAt:receiver.acknowledgedAt}})
}catch(e){return NextResponse.json({success:false,message:e.message},{status:e.status||500})}}
