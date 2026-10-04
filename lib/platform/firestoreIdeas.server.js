import { randomBytes } from 'node:crypto'
import { getAuthAndDatabase } from '@/lib/auth'
import { attendanceId, attendanceError, listAttendanceRecords } from './firestoreAttendance.server'
import { getManyProductivityRecords, queryProductivityByIds } from './firestoreProductivityView.server'
export const IDEAS_DATABASE_OPTIONS={queryFields:{users:['employeeId'],employees:['department','departments'],departments:['isActive'],suggestions:['submittedBy','status','isPublic','isPinned','searchGrams','createdAt']}}
const admin=user=>['admin','hr','owner','superadmin','super_admin'].includes(user?.role)
export async function ideaContext(request){
 const auth=await getAuthAndDatabase(request,IDEAS_DATABASE_OPTIONS)
 if(!auth.success)throw attendanceError(auth.message,401)
 const user=await auth.database.get('users',attendanceId(auth.user._id||auth.user.userId))
 if(!user)throw attendanceError('User not found',401)
 return {...auth,user}
}
export const ideaId=id=>{if(!/^[a-f0-9]{24}$/.test(id||''))throw attendanceError('Invalid idea ID');return id}
export function assertIdeaAccess(idea,user){
 if(!idea||idea.isPublic===false&&attendanceId(idea.submittedBy)!==attendanceId(user.employeeId)&&!admin(user))throw attendanceError('Idea not found',404)
}
export function ideaVotes(idea){
 return Array.isArray(idea.votes)?idea.votes:(idea.votes?.voters||[]).map(v=>({...v,vote:v.vote==='up'?1:v.vote==='down'?-1:Number(v.vote)}))
}
export async function formatIdea(database,idea,user,{detail=false}={}){
 assertIdeaAccess(idea,user)
 const employee=idea.submittedBy?await database.get('employees',attendanceId(idea.submittedBy)):null
 const department=employee?.department?await database.get('departments',attendanceId(employee.department)):null
 const votes=ideaVotes(idea),own=attendanceId(idea.submittedBy)===attendanceId(user.employeeId),myVote=votes.find(v=>attendanceId(v.employee)===attendanceId(user.employeeId))
 const author=idea.isAnonymous?null:{_id:employee?._id,name:[employee?.firstName,employee?.lastName].filter(Boolean).join(' ')||'Unknown',firstName:employee?.firstName,lastName:employee?.lastName,profilePicture:employee?.profilePicture,department:department?.name||'Unknown'}
 const result={_id:idea._id,title:idea.title,description:idea.description,category:idea.category,status:idea.status,isPinned:!!idea.isPinned,isAnonymous:!!idea.isAnonymous,tags:idea.tags||[],author,likes:votes.filter(v=>v.vote===1).length,dislikes:votes.filter(v=>v.vote===-1).length,voteCount:votes.reduce((n,v)=>n+(v.vote||0),0),userVote:myVote?(myVote.vote===1?'upvote':'downvote'):null,commentsCount:idea.comments?.length||0,createdAt:idea.createdAt,updatedAt:idea.updatedAt,isOwner:own}
 if(detail){
  result.submittedBy=author
  const authors=await getManyProductivityRecords(database,'employees',(idea.comments||[]).map(c=>attendanceId(c.author))),map=new Map(authors.map(e=>[e._id,e]))
  result.comments=(idea.comments||[]).map(c=>{const e=map.get(attendanceId(c.author));return {...c,author:e?{_id:e._id,firstName:e.firstName,lastName:e.lastName,profilePicture:e.profilePicture}:null}})
 }
 return result
}
export async function listIdeas(database,user,params){
 const page=Math.max(1,Number(params.get('page'))||1),limit=Math.min(100,Math.max(1,Number(params.get('limit'))||20))
 if(!Number.isInteger(page)||page*limit>2000)throw attendanceError('Requested page exceeds the supported window')
 const filters=[],search=String(params.get('search')||'').trim().toLowerCase()
 if(search.length>200)throw attendanceError('Search is too long')
 if(params.get('tab')==='my'){if(!user.employeeId)return {data:[],total:0,page,limit};filters.push({field:'submittedBy',operator:'==',value:attendanceId(user.employeeId)})}
 else filters.push({field:'isPublic',operator:'==',value:true})
 if(params.get('status'))filters.push({field:'status',operator:'==',value:params.get('status')})
 if(params.get('pinned')==='true')filters.push({field:'isPinned',operator:'==',value:true})
 if(search)filters.push({field:'searchGrams',operator:'array-contains',value:search.slice(0,3)})
 let records,total
 if(params.get('department')){
  const department=ideaId(params.get('department'))
  const groups=await Promise.all([listAttendanceRecords(database,'employees',[{field:'department',operator:'==',value:department}],5000),listAttendanceRecords(database,'employees',[{field:'departments',operator:'array-contains',value:department}],5000)])
  const ids=[...new Set(groups.flat().map(e=>e._id))],mine=filters.find(f=>f.field==='submittedBy')
  records=mine?(ids.includes(mine.value)?await listAttendanceRecords(database,'suggestions',filters,5000):[]):await queryProductivityByIds(database,'suggestions','submittedBy',ids,filters)
 }else if(search)records=await listAttendanceRecords(database,'suggestions',filters,5000)
 else{
  total=await database.count('suggestions',filters)
  records=[];let cursor
  while(records.length<page*limit){const result=await database.list('suggestions',{filters,orderBy:[{field:'createdAt',direction:'desc'}],limit:Math.min(100,page*limit-records.length),cursor});records.push(...result.records);cursor=result.nextCursor;if(!cursor)break}
 }
 if(search)records=records.filter(r=>[r.title,r.description,r.category].some(v=>String(v||'').toLowerCase().includes(search)))
 if(total===undefined)total=records.length
 records.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
 return {data:await Promise.all(records.slice((page-1)*limit,page*limit).map(r=>formatIdea(database,r,user))),total,page,limit}
}
function content(input,current={}){
 const result={}
 for(const[field,max]of [['title',200],['description',10000],['category',100]])if(input[field]!==undefined||!current._id){
  const value=String(input[field]??current[field]??(field==='category'?'other':'')).trim()
  if(!value||value.length>max)throw attendanceError('Invalid '+field)
  result[field]=value
 }
 if(input.isAnonymous!==undefined){if(typeof input.isAnonymous!=='boolean')throw attendanceError('Invalid anonymity setting');result.isAnonymous=input.isAnonymous}
 if(input.tags!==undefined){if(!Array.isArray(input.tags)||input.tags.length>30||input.tags.some(t=>typeof t!=='string'||t.length>100))throw attendanceError('Invalid tags');result.tags=input.tags}
 return result
}
export async function createIdea(database,user,input){
 const employee=user.employeeId?await database.get('employees',attendanceId(user.employeeId)):null
 if(!employee)throw attendanceError('Employee profile not found',404)
 const now=new Date(),record={_id:randomBytes(12).toString('hex'),...content(input),submittedBy:employee._id,status:'pending',type:'idea',isPublic:true,isPinned:false,votes:[],voteCount:0,comments:[],createdAt:now,updatedAt:now}
 await database.create('suggestions',record);return formatIdea(database,record,user)
}
export async function mutateIdea(database,user,id,action,input={}){
 ideaId(id)
 return database.transaction(async tx=>{
  const [current,account]=await Promise.all([tx.get('suggestions',id),tx.get('users',user._id)])
  if(!account)throw attendanceError('Unauthorized',401)
  assertIdeaAccess(current,account)
  const employeeId=attendanceId(account.employeeId),own=attendanceId(current.submittedBy)===employeeId,isAdmin=admin(account)
  let next={...current,updatedAt:new Date()}
  if(action==='delete'){if(!own&&!isAdmin)throw attendanceError('Not authorized',403);await tx.delete('suggestions',id);return null}
  if(action==='vote'){
   if(!employeeId||!await tx.get('employees',employeeId))throw attendanceError('Employee profile not found',404)
   if(!['upvote','downvote','remove'].includes(input.type))throw attendanceError('Invalid vote')
   const votes=ideaVotes(current).filter(v=>attendanceId(v.employee)!==employeeId)
   if(input.type!=='remove')votes.push({employee:employeeId,vote:input.type==='upvote'?1:-1,votedAt:new Date()})
   // Preserve the original record shape when a migrated global-schema record uses nested voters.
   next.votes=Array.isArray(current.votes)||!current.votes?votes:{...current.votes,voters:votes.map(v=>({...v,vote:v.vote===1?'up':'down'})),upvotes:votes.filter(v=>v.vote===1).length,downvotes:votes.filter(v=>v.vote===-1).length}
   next.voteCount=votes.reduce((n,v)=>n+v.vote,0)
  }else if(action==='comment'){
   if(!employeeId||!await tx.get('employees',employeeId))throw attendanceError('Employee profile not found',404)
   if(typeof input.content!=='string'||!input.content.trim()||input.content.length>5000)throw attendanceError('Valid comment content is required')
   next.comments=[...(current.comments||[]),{_id:randomBytes(12).toString('hex'),author:employeeId,content:input.content.trim(),createdAt:new Date()}]
  }else if(action==='update'){
   if(!own&&!isAdmin)throw attendanceError('Not authorized',403)
   if(input.action==='pin'){if(!isAdmin)throw attendanceError('Only admins can pin ideas',403);next.isPinned=!current.isPinned}
   else if(input.action==='toggleAnonymous'){if(!own)throw attendanceError('Only owner can change anonymity',403);next.isAnonymous=!current.isAnonymous}
   else{
    if(own)next={...next,...content(input,current)}
    if(input.status!==undefined){if(!isAdmin)throw attendanceError('Only admins can change status',403);if(!['pending','under-review','approved','rejected','implemented','submitted','under_review','on_hold','cancelled'].includes(input.status))throw attendanceError('Invalid status');next.status=input.status}
   }
  }else throw attendanceError('Invalid action')
  await tx.replace('suggestions',next);return next
 })
}
