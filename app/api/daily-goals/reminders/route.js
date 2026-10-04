import { NextResponse } from 'next/server'
import {dailyGoalContext,listDailyGoals,goalCalendar,remindDailyGoals} from '@/lib/platform/firestoreDailyGoals.server'
import {attendanceId} from '@/lib/platform/firestoreAttendance.server'
export async function POST(request){try{const {database,user}=await dailyGoalContext(request);const data=await remindDailyGoals(database,user,await request.json());return NextResponse.json({success:true,data,message:'Queued '+data.remindersSent+' reminders'})}catch(e){return NextResponse.json({success:false,message:e.message},{status:e.status||500})}}
export async function GET(request){try{
 const {database,user}=await dailyGoalContext(request),params=new URL(request.url).searchParams;params.set('employeeId',params.get('employeeId')||attendanceId(user.employeeId))
 const records=await listDailyGoals(database,user,params),goal=records[0],calendar=await goalCalendar(database)
 const data={morningReminderSent:!!goal?.reminders?.morningReminderSent,eveningReminderSent:!!goal?.reminders?.eveningReminderSent,cutoffReminderSent:!!goal?.reminders?.cutoffReminderSent,managerNotificationSent:!!goal?.reminders?.managerNotificationSent,goalsSet:goal?.goals?.length||0,completionRate:goal?.summary?.completionRate||0,isLocked:!!goal?.submissionStatus?.isLocked,pastCutoff:new Date()>calendar.cutoff}
 return NextResponse.json({success:true,data})
}catch(e){return NextResponse.json({success:false,message:e.message},{status:e.status||500})}}
