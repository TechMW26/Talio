import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { listAttendanceRecords,attendanceId } from '@/lib/platform/firestoreAttendance.server'
import { populateProductivityEmployees } from '@/lib/platform/firestoreProductivityView.server'
import { getDateKeyInTimezone,getTimezone } from '@/lib/timezone'
export async function GET(request){try{
 const auth=await getAuthAndDatabase(request,{queryFields:{employees:['status','birthdayMonthDay','joiningMonthDay']}})
 if(!auth.success)return NextResponse.json({success:false,message:auth.message},{status:401})
 const settings=(await auth.database.list('companysettings',{limit:1})).records[0]||{},date=getDateKeyInTimezone(new Date(),getTimezone(settings.timezone)),monthDay=date.slice(5),year=Number(date.slice(0,4))
 const lists=await Promise.all(['birthdayMonthDay','joiningMonthDay'].map(field=>listAttendanceRecords(auth.database,'employees',[{field:'status',operator:'==',value:'active'},{field,operator:'==',value:monthDay}],5000)))
 const records=await populateProductivityEmployees(auth.database,[...new Map(lists.flat().map(e=>[e._id,e])).values()]),birthdays=[],anniversaries=[]
 for(const e of records){const item={_id:e._id,firstName:e.firstName,lastName:e.lastName,profilePicture:e.profilePicture,department:e.department?.name||''};if(e.birthdayMonthDay===monthDay)birthdays.push(item);if(e.joiningMonthDay===monthDay){const years=year-new Date(e.dateOfJoining).getUTCFullYear();if(years>=1)anniversaries.push({...item,years})}}
 return NextResponse.json({success:true,currentEmployeeId:attendanceId(auth.user.employeeId),birthdays,anniversaries})
}catch(e){return NextResponse.json({success:false,message:'Unable to load celebrations'},{status:e.status||500})}}
