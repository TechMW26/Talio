import {NextResponse} from 'next/server'
import {callAlertContext,callAlertRecipients} from '@/lib/platform/firestoreCallAlerts.server'
export async function GET(request){try{const context=await callAlertContext(request,true);return NextResponse.json({success:true,data:await callAlertRecipients(context)})}catch(e){return NextResponse.json({success:false,message:e.message},{status:e.status||500})}}
