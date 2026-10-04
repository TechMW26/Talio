import { NextResponse } from 'next/server'
import { ideaContext,mutateIdea,formatIdea } from '@/lib/platform/firestoreIdeas.server'
export async function POST(request,{params}){try{const {database,user}=await ideaContext(request),{id}=await params;const result=await formatIdea(database,await mutateIdea(database,user,id,'vote',await request.json()),user);const {likes,dislikes,userVote,voteCount}=result;return NextResponse.json({success:true,data:{likes,dislikes,userVote,voteCount}})}catch(e){return NextResponse.json({success:false,message:e.message},{status:e.status||500})}}
