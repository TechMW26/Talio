import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getCronAuthErrorResponse } from '@/lib/cronAuth'
import { getFirestoreSystemDatabase } from '@/lib/platform/firestoreApplication.server'
import { getAttendanceStore, getAttendanceSettings, listAttendanceRecords, attendanceError } from '@/lib/platform/firestoreAttendance.server'
import { recoverAttendanceDay } from '@/lib/attendanceNotificationScheduler'
import { getDateKeyInTimezone, getTimezone } from '@/lib/timezone'
import { previousDateKey } from '@/lib/attendanceAutoCheckout'
export const dynamic='force-dynamic'
export const maxDuration=120
async function tenants(slug) {
  const system=await getFirestoreSystemDatabase({queryFields:{tenantcompanies:['isActive','slug']}})
  const filters=[{field:'isActive',operator:'==',value:true}]
  if(slug) filters.push({field:'slug',operator:'==',value:slug})
  return (await listAttendanceRecords(system,'tenantcompanies',filters)).filter(t=>t.isSetupComplete&&['active','trial'].includes(t.serviceStatus))
}
async function run(authorized, input={}, includeBacklog=false) {
  const result={success:true,dryRun:input.dryRun===true,tenantsProcessed:0,totalAutoCheckouts:0,totalNotificationsSent:0,totalNotificationsFailed:0,totalRectified:0,totalAlreadyCorrect:0,tenantResults:[],rectificationResults:[]}
  for(const tenant of authorized) {
    try {
      const database=await getAttendanceStore(tenant.databaseName),{company,settings}=await getAttendanceSettings(database)
      const timezone=getTimezone(company.timezone||settings.timezone),today=getDateKeyInTimezone(new Date(),timezone),date=input.date||previousDateKey(today)
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(+new Date(date))||new Date(date).toISOString().slice(0,10)!==date||date>=today) throw attendanceError('Select a valid past calendar date')
      const output=await recoverAttendanceDay(database,date,{includeBacklog,dryRun:input.dryRun===true,skipRectification:input.skipRectification===true})
      result.tenantsProcessed++;result.totalAutoCheckouts+=output.processed;result.totalRectified+=output.rectified;result.totalAlreadyCorrect+=output.alreadyCorrect;result.totalNotificationsSent+=output.notified
      result.tenantResults.push({tenantName:tenant.name,tenantSlug:tenant.slug,success:output.errors.length===0,autoCheckouts:output.processed,notificationsSent:output.notified,errors:output.errors,dryRun:output.dryRun})
      result.rectificationResults.push({tenantName:tenant.name,tenantSlug:tenant.slug,success:output.errors.length===0,rectified:output.rectified,alreadyCorrect:output.alreadyCorrect,errors:output.errors})
    } catch(error) {result.success=false;result.tenantResults.push({tenantName:tenant.name,tenantSlug:tenant.slug,success:false,error:error.message})}
  }
  return result
}
export async function GET(request) {
  const error=getCronAuthErrorResponse(request)
  if(error)return error
  try { const results=await run(await tenants(),{},true);return NextResponse.json({success:results.success,message:'Attendance recovery completed',results}) }
  catch(error){return NextResponse.json({success:false,error:error.message},{status:500})}
}
export async function POST(request) {
  try {
    const cron=!getCronAuthErrorResponse(request),auth=cron?null:await getAuthAndDatabase(request)
    if(!cron&&(!auth?.success||!['admin','hr','owner','superadmin','super_admin'].includes(auth.user.role))) throw attendanceError('Unauthorized',403)
    const input=await request.json().catch(()=>({}))
    if(!cron&&input.tenantSlug&&input.tenantSlug!==auth.tenant.slug)throw attendanceError('Cross-tenant operation denied',403)
    return NextResponse.json(await run(cron?await tenants(input.tenantSlug):[auth.tenant],input,false))
  } catch(error){return NextResponse.json({success:false,error:error.message},{status:error.status||500})}
}
