import { NextResponse } from 'next/server'
import { ideaContext,listIdeas,createIdea } from '@/lib/platform/firestoreIdeas.server'
import { listAttendanceRecords } from '@/lib/platform/firestoreAttendance.server'
export async function GET(request){try{
 const {database,user}=await ideaContext(request),result=await listIdeas(database,user,new URL(request.url).searchParams)
 const departments=(await listAttendanceRecords(database,'departments',[{field:'isActive',operator:'==',value:true}],1000)).map(d=>({_id:d._id,name:d.name})).sort((a,b)=>a.name.localeCompare(b.name))
 return NextResponse.json({success:true,data:result.data,departments,pagination:{page:result.page,limit:result.limit,total:result.total,pages:Math.ceil(result.total/result.limit)}})
}catch(e){return NextResponse.json({success:false,message:e.message},{status:e.status||500})}}
export async function POST(request){try{const {database,user}=await ideaContext(request);return NextResponse.json({success:true,message:'Idea submitted successfully',data:await createIdea(database,user,await request.json())})}catch(e){return NextResponse.json({success:false,message:e.message},{status:e.status||500})}}
