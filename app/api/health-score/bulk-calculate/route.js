import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// POST - Calculate health scores for multiple employees or all employees
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['HealthScore', 'Employee', 'Attendance', 'Performance', 'Leave'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { HealthScore, Employee, Attendance, Performance, Leave } = models

    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 403 })
    }

    const { employeeIds, department, forceRecalculate = false } = await request.json()

    let query = { status: 'active' }
    
    // Filter by specific employees
    if (employeeIds && employeeIds.length > 0) {
      query._id = { $in: employeeIds }
    }
    
    // Filter by department
    if (department) {
      query.department = department
    }

    const employees = await Employee.find(query)
    
    const results = {
      processed: 0,
      updated: 0,
      errors: 0,
      criticalCases: [],
      salaryDeductionRisks: [],
      departmentSummary: {},
      averageScore: 0
    }

    let totalScore = 0
    const departmentScores = {}

    for (const employee of employees) {
      try {
        results.processed++
        
        // Get or create health score record
        let healthScore = await HealthScore.findOne({ employee: employee._id })
        if (!healthScore) {
          healthScore = new HealthScore({ employee: employee._id })
        }

        // Check if we need to recalculate
        const lastCalculated = healthScore.metrics.lastCalculated
        const today = new Date()
        const shouldRecalculate = forceRecalculate || 
          !lastCalculated || 
          (today - lastCalculated) > (24 * 60 * 60 * 1000) // 24 hours

        if (shouldRecalculate) {
          await calculateHealthScore(healthScore, employee._id)
          results.updated++

          // Track critical cases
          if (healthScore.riskLevel === 'critical') {
            results.criticalCases.push({
              employeeId: employee._id,
              name: `${employee.firstName} ${employee.lastName}`,
              employeeCode: employee.employeeCode,
              score: healthScore.overallScore,
              department: employee.department,
              riskLevel: healthScore.riskLevel
            })
          }

          // Track salary deduction risks
          if (healthScore.salaryDeductionRisk) {
            results.salaryDeductionRisks.push({
              employeeId: employee._id,
              name: `${employee.firstName} ${employee.lastName}`,
              employeeCode: employee.employeeCode,
              score: healthScore.overallScore,
              attendanceScore: healthScore.attendanceScore,
              punctualityScore: healthScore.punctualityScore,
              department: employee.department
            })
          }

          // Department-wise tracking
          if (!departmentScores[employee.department]) {
            departmentScores[employee.department] = {
              totalScore: 0,
              count: 0,
              criticalCount: 0,
              riskCount: 0
            }
          }
          
          departmentScores[employee.department].totalScore += healthScore.overallScore
          departmentScores[employee.department].count += 1
          
          if (healthScore.riskLevel === 'critical') {
            departmentScores[employee.department].criticalCount += 1
          }
          
          if (healthScore.salaryDeductionRisk) {
            departmentScores[employee.department].riskCount += 1
          }

          totalScore += healthScore.overallScore
        }

      } catch (error) {
        console.error(`Error calculating health score for employee ${employee._id}:`, error)
        results.errors++
      }
    }

    // Calculate department summaries
    for (const [dept, data] of Object.entries(departmentScores)) {
      results.departmentSummary[dept] = {
        averageScore: data.count > 0 ? (data.totalScore / data.count).toFixed(1) : 0,
        totalEmployees: data.count,
        criticalCases: data.criticalCount,
        salaryRisks: data.riskCount,
        healthyEmployees: data.count - data.criticalCount - data.riskCount
      }
    }

    // Calculate overall average
    results.averageScore = results.updated > 0 ? (totalScore / results.updated).toFixed(1) : 0

    return NextResponse.json({
      success: true,
      message: `Health scores calculated for ${results.updated} employees`,
      data: results
    })

  } catch (error) {
    console.error('Bulk calculate health scores error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to calculate health scores' },
      { status: 500 }
    )
  }
}

// Helper function to calculate health score
async function calculateHealthScore(healthScore, employeeId) {
  const now = new Date()
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
  
  // 1. Calculate Attendance Score
  const attendanceData = await Attendance.aggregate([
    {
      $match: {
        employee: employeeId,
        date: { $gte: threeMonthsAgo, $lte: now }
      }
    },
    {
      $group: {
        _id: null,
        totalDays: { $sum: 1 },
        presentDays: {
          $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
        },
        absentDays: {
          $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] }
        },
        lateDays: {
          $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] }
        },
        halfDays: {
          $sum: { $cond: [{ $eq: ['$status', 'half-day'] }, 1, 0] }
        }
      }
    }
  ])

  const attendance = attendanceData[0] || {
    totalDays: 0, presentDays: 0, absentDays: 0, lateDays: 0, halfDays: 0
  }

  // Update metrics
  healthScore.metrics.totalWorkingDays = attendance.totalDays
  healthScore.metrics.presentDays = attendance.presentDays
  healthScore.metrics.absentDays = attendance.absentDays
  healthScore.metrics.lateDays = attendance.lateDays
  healthScore.metrics.halfDays = attendance.halfDays

  // Calculate attendance rate
  const attendanceRate = attendance.totalDays > 0 ? 
    ((attendance.presentDays + attendance.lateDays + attendance.halfDays) / attendance.totalDays) * 100 : 100
  
  healthScore.metrics.attendanceRate = attendanceRate
  healthScore.attendanceScore = Math.max(0, attendanceRate - (attendance.absentDays * 2))

  // 2. Calculate Punctuality Score
  const punctualityRate = attendance.totalDays > 0 ? 
    ((attendance.totalDays - attendance.lateDays) / attendance.totalDays) * 100 : 100
  
  healthScore.metrics.punctualityRate = punctualityRate
  healthScore.punctualityScore = Math.max(0, punctualityRate - (attendance.lateDays * 1.5))

  // 3. Calculate Performance Score
  const performanceData = await Performance.find({
    employee: employeeId,
    createdAt: { $gte: threeMonthsAgo }
  }).sort({ createdAt: -1 }).limit(3)

  if (performanceData.length > 0) {
    const avgRating = performanceData.reduce((sum, perf) => sum + perf.overallRating, 0) / performanceData.length
    healthScore.metrics.averagePerformanceRating = avgRating
    healthScore.performanceScore = (avgRating / 5) * 100
  }

  // 4. Calculate Leave Score
  const leaveData = await Leave.find({
    employee: employeeId,
    createdAt: { $gte: threeMonthsAgo },
    status: { $in: ['approved', 'rejected'] }
  })

  const unapprovedLeaves = leaveData.filter(leave => leave.status === 'rejected').length
  healthScore.metrics.unapprovedLeaves = unapprovedLeaves
  healthScore.leaveScore = Math.max(0, 100 - (unapprovedLeaves * 10))

  // 5. Calculate overall score and risk assessment
  healthScore.calculateOverallScore()

  // 6. Add warnings based on scores
  if (healthScore.attendanceScore < 80) {
    healthScore.addWarning('attendance', 
      `Low attendance rate: ${healthScore.metrics.attendanceRate.toFixed(1)}%`, 
      healthScore.attendanceScore < 60 ? 'high' : 'medium')
  }

  if (healthScore.punctualityScore < 75) {
    healthScore.addWarning('punctuality', 
      `Frequent late arrivals: ${attendance.lateDays} days in last 3 months`, 
      healthScore.punctualityScore < 50 ? 'high' : 'medium')
  }

  if (healthScore.performanceScore < 70) {
    healthScore.addWarning('performance', 
      `Below average performance rating: ${healthScore.metrics.averagePerformanceRating.toFixed(1)}/5`, 
      'medium')
  }

  // 7. Save to history
  healthScore.saveToHistory(`Bulk calculation on ${now.toDateString()}`)

  // 8. Update last calculated time
  healthScore.metrics.lastCalculated = now

  await healthScore.save()
  return healthScore
}
