import { NextResponse } from 'next/server'
import { activityContext, activityTeam } from '@/lib/platform/firestoreActivity.server'
export async function GET(request) {
  try {
    const { database, user } = await activityContext(request)
    const {scope,team,departments} = await activityTeam(database,user,new URL(request.url).searchParams.get('departmentId'))
    return NextResponse.json({success:true,isAdmin:scope.admin,isDepartmentHead:scope.departments.length>0,isManager:!scope.admin&&scope.departments.length===0&&scope.employees.length>1,team,departments})
  } catch(error) {return NextResponse.json({success:false,error:error.message},{status:error.status||500})}
}
