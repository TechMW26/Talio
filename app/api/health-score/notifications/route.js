import { NextResponse } from 'next/server'
import { healthContext, visibleHealthEmployees } from '@/lib/platform/firestoreHealthScore.server'
import { attendanceId, attendanceError } from '@/lib/platform/firestoreAttendance.server'
async function target(database,user,requested){
 const id=requested||attendanceId(user.employeeId)
 if(!id)throw attendanceError('No employee profile linked',404)
 await visibleHealthEmployees(database,user,id)
 const records=(await database.list('healthscores',{filters:[{field:'employee',operator:'==',value:id}],limit:2})).records
 if(records.length>1)throw attendanceError('Duplicate health scores require reconciliation',409)
 return records[0]||null
}
export async function GET(request){
 try{
  const {database,user}=await healthContext(request)
  const healthScore=await target(database,user,new URL(request.url).searchParams.get('employeeId'))
  if(!healthScore)return NextResponse.json({success:true,data:{notifications:[],riskLevel:'low',salaryDeductionRisk:false}})
    // Generate real-time notifications
    const notifications = []

    // Salary deduction risk notification
    if (healthScore.salaryDeductionRisk) {
      notifications.push({
        id: 'salary_risk',
        type: 'critical',
        title: 'Salary Deduction Risk',
        message: `Your attendance or punctuality score is below threshold. This may impact your salary.`,
        details: {
          overallScore: healthScore.overallScore,
          attendanceScore: healthScore.attendanceScore,
          punctualityScore: healthScore.punctualityScore,
          threshold: 70
        },
        actionRequired: true,
        timestamp: new Date()
      })
    }

    // Low health score warning
    if (healthScore.overallScore < 75) {
      notifications.push({
        id: 'low_health_score',
        type: healthScore.overallScore < 60 ? 'critical' : 'warning',
        title: 'Health Score Alert',
        message: `Your employee health score is ${healthScore.overallScore}/100. Improvement needed.`,
        details: {
          currentScore: healthScore.overallScore,
          riskLevel: healthScore.riskLevel,
          areas: []
        },
        actionRequired: true,
        timestamp: new Date()
      })

      // Add specific areas needing improvement
      if (healthScore.attendanceScore < 80) {
        notifications[notifications.length - 1].details.areas.push('Attendance')
      }
      if (healthScore.punctualityScore < 75) {
        notifications[notifications.length - 1].details.areas.push('Punctuality')
      }
      if (healthScore.performanceScore < 70) {
        notifications[notifications.length - 1].details.areas.push('Performance')
      }
    }

    // Recent warnings
    const recentWarnings = healthScore.warnings
      .filter(warning => !warning.acknowledged)
      .slice(-3) // Last 3 unacknowledged warnings

    recentWarnings.forEach((warning, index) => {
      notifications.push({
        id: warning._id || `warning_${index}`,
        warningId: warning._id,
        type: warning.severity === 'critical' ? 'critical' : 'warning',
        title: `${warning.type.charAt(0).toUpperCase() + warning.type.slice(1)} Warning`,
        message: warning.message,
        details: {
          warningType: warning.type,
          severity: warning.severity,
          date: warning.date
        },
        actionRequired: warning.severity === 'critical',
        timestamp: warning.date
      })
    })

    // Improvement plan notifications
    if (healthScore.improvementPlan?.isActive) {
      const daysLeft = Math.ceil((new Date(healthScore.improvementPlan.endDate) - new Date()) / (1000 * 60 * 60 * 24))

      if (daysLeft > 0) {
        notifications.push({
          id: 'improvement_plan',
          type: 'info',
          title: 'Improvement Plan Active',
          message: `You have ${daysLeft} days left to reach your target score of ${healthScore.improvementPlan.targetScore}.`,
          details: {
            currentScore: healthScore.overallScore,
            targetScore: healthScore.improvementPlan.targetScore,
            daysLeft,
            goals: healthScore.improvementPlan.goals
          },
          actionRequired: false,
          timestamp: new Date()
        })
      }
    }

    // Positive reinforcement for good scores
    if (healthScore.overallScore >= 90 && notifications.length === 0) {
      notifications.push({
        id: 'excellent_performance',
        type: 'success',
        title: 'Excellent Performance!',
        message: `Great job! Your health score is ${healthScore.overallScore}/100. Keep up the excellent work!`,
        details: {
          score: healthScore.overallScore,
          riskLevel: healthScore.riskLevel
        },
        actionRequired: false,
        timestamp: new Date()
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        notifications,
        riskLevel: healthScore.riskLevel,
        salaryDeductionRisk: healthScore.salaryDeductionRisk,
        overallScore: healthScore.overallScore,
        lastUpdated: healthScore.metrics?.lastCalculated
      }
    })

 }catch(error){return NextResponse.json({success:false,message:error.message},{status:error.status||500})}
}
export async function POST(request){
 try{
  const {database,user}=await healthContext(request)
  const {employeeId,warningId,acknowledgeAll=false}=await request.json()
  if(typeof acknowledgeAll!=='boolean'||!acknowledgeAll&&!warningId)throw attendanceError('Select a warning to acknowledge')
  const score=await target(database,user,employeeId)
  if(!score)throw attendanceError('Health score not found',404)
  const updated=await database.mutate('healthscores',score._id,current=>{
   const warnings=current.warnings||[]
   if(!acknowledgeAll&&!warnings.some(w=>attendanceId(w._id)===warningId))throw attendanceError('Warning not found',404)
   return {...current,warnings:warnings.map(w=>acknowledgeAll||attendanceId(w._id)===warningId?{...w,acknowledged:true}:w),updatedAt:new Date()}
  })
  if(!updated)throw attendanceError('Health score not found',404)
  return NextResponse.json({success:true,message:'Notification acknowledged'})
 }catch(error){return NextResponse.json({success:false,message:error.message},{status:error.status||500})}
}
