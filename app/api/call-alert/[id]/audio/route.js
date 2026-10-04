import {NextResponse} from 'next/server'
import {callAlertContext} from '@/lib/platform/firestoreCallAlerts.server'
import {attendanceId,attendanceError} from '@/lib/platform/firestoreAttendance.server'
import {getTenantBlob,buildTenantRootPrefix} from '@/lib/platform/blobStorage.server'
export async function GET(request,{params}){try{
 const {database,user,tenant}=await callAlertContext(request),{id}=await params,receiverId=new URL(request.url).searchParams.get('receiverId')||user._id
 if(!/^[a-f0-9]{24}$/.test(id||''))throw attendanceError('Invalid alert ID')
 const record=await database.get('callalerts',id)
 if(!record||!(record.receivers||[]).some(r=>attendanceId(r.user)===receiverId)||(user._id!==attendanceId(record.sender)&&user._id!==receiverId))throw attendanceError('Audio not found',404)
 const audio=record.voiceGeneration?.audioUrls?.find(v=>attendanceId(v.receiverId)===receiverId)
 if(!audio?.storage?.pathname?.startsWith(buildTenantRootPrefix(tenant.databaseName)+'/call-alerts/'+id+'/'))throw attendanceError('Audio not found',404)
 const result=await getTenantBlob(audio.storage.pathname,{access:'private'})
 if(!result?.stream)throw attendanceError('Audio not found',404)
 return new NextResponse(result.stream,{headers:{'Content-Type':audio.storage.contentType||'audio/mpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
}catch(e){return NextResponse.json({success:false,message:e.message},{status:e.status||500})}}
