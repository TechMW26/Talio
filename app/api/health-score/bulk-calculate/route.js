import { NextResponse } from 'next/server'
import { healthContext, bulkCalculateHealth } from '@/lib/platform/firestoreHealthScore.server'
export async function POST(request){
 try{
 const {database,user}=await healthContext(request,true)
 const input=await request.json()
 const data=await bulkCalculateHealth(database,user,input)
 return NextResponse.json({success:true,message:'Health scores calculated for '+data.updated+' employees',data})
 }catch(error){return NextResponse.json({success:false,message:error.message},{status:error.status||500})}
}
