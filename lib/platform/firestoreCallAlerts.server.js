import { randomBytes } from 'node:crypto'
import { getAuthAndDatabase } from '@/lib/auth'
import { attendanceId,attendanceError,listAttendanceRecords } from './firestoreAttendance.server'
import { getManyProductivityRecords,queryProductivityByIds,populateProductivityEmployees } from './firestoreProductivityView.server'
import { generateSpeechBase64,processMessageTemplate,PREBUILT_MESSAGES } from '@/lib/audio'
import { uploadTenantBlob } from './blobStorage.server'
import { emitRealtimeEvent } from '@/lib/realtimeEvents'
export const CALL_ALERT_DATABASE_OPTIONS={queryFields:{users:['employeeId','isActive'],employees:['status','department'],departments:['head','heads','isActive'],callalerts:['sender','receiverUserIds','createdAt']}}
const administrator=user=>['admin','hr','owner','superadmin','super_admin'].includes(user?.role)
export async function callAlertContext(request,send=false){
 const auth=await getAuthAndDatabase(request,CALL_ALERT_DATABASE_OPTIONS)
 if(!auth.success)throw attendanceError(auth.message,401)
 const user=await auth.database.get('users',attendanceId(auth.user._id||auth.user.userId))
 if(!user||user.isActive===false)throw attendanceError('User not found or inactive',401)
 const employee=user.employeeId?await auth.database.get('employees',attendanceId(user.employeeId)):null
 let departments=[]
 if(employee){const lists=await Promise.all([listAttendanceRecords(auth.database,'departments',[{field:'head',operator:'==',value:employee._id}],1000),listAttendanceRecords(auth.database,'departments',[{field:'heads',operator:'array-contains',value:employee._id}],1000)]);departments=[...new Map(lists.flat().filter(d=>d.isActive!==false).map(d=>[d._id,d])).values()]}
 const isDepartmentHead=departments.length>0||user.role==='department_head'
 if(send&&(!administrator(user)&&!isDepartmentHead))throw attendanceError('You do not have permission to send call alerts',403)
 if(send&&!employee)throw attendanceError('Employee profile not found',404)
 return {...auth,user,employee,isAdmin:administrator(user),isDepartmentHead,departments}
}
export async function callAlertRecipients(context){
 const {database,user}=context
 const accounts=(await listAttendanceRecords(database,'users',[{field:'isActive',operator:'==',value:true}],10000)).filter(u=>u._id!==user._id&&u.employeeId)
 const employees=await populateProductivityEmployees(database,await getManyProductivityRecords(database,'employees',accounts.map(u=>attendanceId(u.employeeId)))),byEmployee=new Map(employees.map(e=>[e._id,e]))
 const recipients=accounts.map(u=>{const e=byEmployee.get(attendanceId(u.employeeId));return e&&e.isActive!==false?{userId:u._id,employeeId:e._id,name:[e.firstName,e.lastName].filter(Boolean).join(' '),email:u.email,employeeCode:e.employeeCode,role:u.role,department:e.department?.name||'No Department',departmentId:e.department?._id||null,designation:e.designation?.title||'No Designation',profilePicture:e.profilePicture}:null}).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name))
 const departments=(await listAttendanceRecords(database,'departments',[{field:'isActive',operator:'==',value:true}],1000)).map(d=>({_id:d._id,name:d.name})).sort((a,b)=>a.name.localeCompare(b.name))
 return {recipients,departments,permissions:{isAdmin:context.isAdmin,isDepartmentHead:context.isDepartmentHead,hasFullAccess:true,headOfDepartments:context.departments.map(d=>d._id)}}
}
export async function createCallAlert(context,input){
 const {database,user,employee,tenant}=context
 if(!Array.isArray(input.targetUserIds)||!input.targetUserIds.length||input.targetUserIds.length>50||input.targetUserIds.some(id=>!/^[a-f0-9]{24}$/.test(id)))throw attendanceError('Select between 1 and 50 valid recipients')
 const priority=input.priority||'high',alertSound=input.alertSound||'default',triggerPlatform=input.triggerPlatform||'web',triggerLocation=String(input.triggerLocation||'dashboard').slice(0,100)
 if(!['low','normal','medium','high','urgent'].includes(priority)||!['web','desktop','mobile','api'].includes(triggerPlatform))throw attendanceError('Invalid alert options')
 const template=input.prebuiltMessageId?PREBUILT_MESSAGES.find(m=>m.id===input.prebuiltMessageId)?.template:input.messageTemplate
 if(typeof template!=='string'||!template.trim()||template.length>2000)throw attendanceError('A message of at most 2000 characters is required')
 if(typeof alertSound!=='string'||alertSound.length>100)throw attendanceError('Invalid alert sound')
 const targets=(await getManyProductivityRecords(database,'users',[...new Set(input.targetUserIds)])).filter(u=>u.isActive!==false&&u.employeeId)
 if(targets.length!==new Set(input.targetUserIds).size)throw attendanceError('One or more recipients are unavailable')
 const targetEmployees=await populateProductivityEmployees(database,await getManyProductivityRecords(database,'employees',targets.map(u=>attendanceId(u.employeeId)))),map=new Map(targetEmployees.map(e=>[e._id,e]))
 const senderName=[employee.firstName,employee.lastName].filter(Boolean).join(' '),receivers=[],processedMessages=[],id=randomBytes(12).toString('hex'),now=new Date()
 for(const target of targets){const e=map.get(attendanceId(target.employeeId));if(!e)throw attendanceError('Recipient profile missing');const name=[e.firstName,e.lastName].filter(Boolean).join(' '),departmentName=e.department?.name||'Unknown Department';receivers.push({user:target._id,employee:e._id,name,department:e.department?._id||null,departmentName,deliveryStatus:{socketIO:{delivered:false},web:{received:false,audioPlayed:false},desktop:{received:false,audioPlayed:false},mobile:{received:false,audioPlayed:false}},acknowledged:false});processedMessages.push({receiverId:target._id,message:processMessageTemplate(template,{senderName,senderRole:user.role,receiverName:name,receiverDepartment:departmentName})})}
 const generateVoice=input.generateVoice!==false&&process.env.TALIO_LOCAL_ACCEPTANCE!=='1'
 let record={_id:id,sender:user._id,senderEmployee:employee._id,senderRole:user.role,senderName,receivers,processedMessages,messageTemplate:template,priority,alertSound,triggerPlatform,triggerLocation,status:'pending',voiceGeneration:{status:generateVoice?'generating':'skipped',audioUrls:[]},createdAt:now,updatedAt:now}
 await database.create('callalerts',record)
 const voices=[]
 if(generateVoice)for(const pm of processedMessages){
  try{
   const speech=await generateSpeechBase64(pm.message,{preset:priority==='urgent'?'urgent':'default'})
   const match=speech.success&&/^data:(audio\/[\w.+-]+);base64,([a-zA-Z0-9+/=]+)$/.exec(speech.audioDataUrl||'')
   if(!match)throw new Error('Voice generation unavailable')
   const body=Buffer.from(match[2],'base64')
   if(!body.length||body.length>4*1024*1024)throw new Error('Generated audio exceeds limit')
   const storage=await uploadTenantBlob({tenantId:tenant.databaseName,category:'call-alerts',ownerId:id,filename:pm.receiverId+'.mp3',body,contentType:match[1],access:'private'})
   voices.push({receiverId:pm.receiverId,url:'/api/call-alert/'+id+'/audio?receiverId='+pm.receiverId,storage,generatedAt:new Date()})
  }catch{voices.push({receiverId:pm.receiverId,error:'Voice generation unavailable'})}
 }
 record=await database.mutate('callalerts',id,current=>({...current,voiceGeneration:{status:generateVoice?(voices.some(v=>v.storage)?'completed':'failed'):'skipped',audioUrls:voices.filter(v=>v.storage),generatedAt:new Date()},updatedAt:new Date()}))
 const delivered=[]
 if(process.env.TALIO_LOCAL_ACCEPTANCE!=='1')for(const receiver of receivers){
  const pm=processedMessages.find(v=>v.receiverId===receiver.user),voice=voices.find(v=>v.receiverId===receiver.user&&v.storage)
  const sent=emitRealtimeEvent('call-alert',{alertId:id,sender:{id:user._id,name:senderName,role:user.role,employeeCode:employee.employeeCode},message:pm.message,priority,alertSound,voiceEnabled:!!voice,audioDataUrl:voice?.url||null,timestamp:now.toISOString(),triggerPlatform,triggerLocation},{userIds:[receiver.user],databaseName:tenant.databaseName})
  if(sent)delivered.push(receiver.user)
 }
 if(delivered.length)record=await database.mutate('callalerts',id,current=>({...current,status:current.status==='completed'?'completed':'sent',sentAt:new Date(),receivers:current.receivers.map(r=>delivered.includes(attendanceId(r.user))?{...r,deliveryStatus:{...r.deliveryStatus,socketIO:{...r.deliveryStatus?.socketIO,delivered:true,deliveredAt:new Date()}}}:r),updatedAt:new Date()}))
 return record
}
export async function acknowledgeCallAlert(database,user,id,input){
 if(!/^[a-f0-9]{24}$/.test(id||''))throw attendanceError('Invalid alert ID')
 const platform=input.platform||'web'
 if(!['web','desktop','mobile'].includes(platform))throw attendanceError('Invalid platform')
 const record=await database.mutate('callalerts',id,current=>{
  if(!(current.receivers||[]).some(r=>attendanceId(r.user)===user._id))throw attendanceError('You are not a recipient of this alert',403)
  const now=new Date(),receivers=current.receivers.map(r=>attendanceId(r.user)===user._id?{...r,acknowledged:true,acknowledgedAt:r.acknowledgedAt||now,deliveryStatus:{...r.deliveryStatus,[platform]:{...r.deliveryStatus?.[platform],received:true,receivedAt:r.deliveryStatus?.[platform]?.receivedAt||now,...(input.audioPlayed?{audioPlayed:true,audioPlayedAt:r.deliveryStatus?.[platform]?.audioPlayedAt||now}:{})}}}:r)
  return {...current,receivers,...(receivers.every(r=>r.acknowledged)?{status:'completed',completedAt:current.completedAt||now}:{}),updatedAt:now}
 })
 if(!record)throw attendanceError('Alert not found',404)
 return record
}
export async function listCallAlerts(context,params){
 const {database,user,isAdmin}=context,type=params.get('type')||'received',limit=Number(params.get('limit')||20),skip=Number(params.get('skip')||0)
 if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(skip)||skip<0||skip+limit>2000)throw attendanceError('Invalid pagination')
 if(type==='logs'&&!isAdmin)throw attendanceError('Only administrators can read all alert logs',403)
 const filters=type==='logs'?[]:type==='sent'?[{field:'sender',operator:'==',value:user._id}]:[{field:'receiverUserIds',operator:'array-contains',value:user._id}]
 let records=[],cursor
 while(records.length<skip+limit){const page=await database.list('callalerts',{filters,orderBy:[{field:'createdAt',direction:'desc'}],limit:Math.min(100,skip+limit-records.length),cursor});records.push(...page.records);cursor=page.nextCursor;if(!cursor)break}
 return records.slice(skip,skip+limit).map(r=>{
  const privileged=isAdmin||attendanceId(r.sender)===user._id
  const {receiverUserIds,...record}=r
  return {...record,receivers:privileged?r.receivers:(r.receivers||[]).filter(v=>attendanceId(v.user)===user._id),processedMessages:privileged?r.processedMessages:(r.processedMessages||[]).filter(v=>attendanceId(v.receiverId)===user._id),voiceGeneration:{...r.voiceGeneration,audioUrls:(r.voiceGeneration?.audioUrls||[]).filter(v=>privileged||attendanceId(v.receiverId)===user._id).map(({storage,...v})=>v)}}
 })
}
