import { NextResponse } from 'next/server'
import { healthContext, visibleHealthEmployees, readHealthScores, calculateNativeHealthScore } from '@/lib/platform/firestoreHealthScore.server'
export async function GET(request){
 try{const {database,user}=await healthContext(request);const employees=await visibleHealthEmployees(database,user,new URL(request.url).searchParams.get('employeeId'));return NextResponse.json({success:true,data:await readHealthScores(database,employees)})}
 catch(error){return NextResponse.json({success:false,message:error.message},{status:error.status||500})}
}
export async function POST(request){
 try{const {database}=await healthContext(request,true);const input=await request.json();const {record}=await calculateNativeHealthScore(database,input.employeeId,{forceRecalculate:input.forceRecalculate===true});return NextResponse.json({success:true,data:record})}
 catch(error){return NextResponse.json({success:false,message:error.message},{status:error.status||500})}
}
