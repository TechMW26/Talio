import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'

// GET - Get health scores
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['HealthScore', 'Employee', 'Attendance', 'Performance', 'Leave'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { HealthScore, Employee, Attendance, Performance, Leave } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')

    let query = {}
    
    // Role-based access control
    if (decoded.role === 'employee') {
      query.employee = decoded.userId
    } else if (employeeId) {
      query.employee = employeeId
    }

    const healthScores = await HealthScore.find(query)
      .populate('employee', 'firstName lastName employeeCode department designation')
      .populate('improvementPlan.mentor', 'firstName lastName')
      .sort({ overallScore: 1 }) // Show lowest scores first

    return NextResponse.json({
      success: true,
      data: healthScores
    })

  } catch (error) {
    console.error('Get health scores error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch health scores' },
      { status: 500 }
    )
  }
}

// POST - Calculate and update health score for employee
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded || !['admin', 'hr'].includes(decoded.role)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 403 })
    }

    const { employeeId, forceRecalculate = false } = await request.json()

    if (!employeeId) {
      return NextResponse.json({ success: false, message: 'Employee ID is required' }, { status: 400 })
    }

    const employee = await Employee.findById(employeeId)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Get or create health score record
    let healthScore = await HealthScore.findOne({ employee: employeeId })
    if (!healthScore) {
      healthScore = new HealthScore({ employee: employeeId })
    }

    // Check if we need to recalculate (daily or forced)
    const lastCalculated = healthScore.metrics.lastCalculated
    const today = new Date()
    const shouldRecalculate = forceRecalculate || 
      !lastCalculated || 
      (today - lastCalculated) > (24 * 60 * 60 * 1000) // 24 hours

    if (shouldRecalculate) {
      await calculateHealthScore(healthScore, employeeId)
    }

    return NextResponse.json({
      success: true,
      data: healthScore
    })

  } catch (error) {
    console.error('Calculate health score error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to calculate health score' },
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
  healthScore.attendanceScore = Math.max(0, attendanceRate - (attendance.absentDays * 2)) // Penalty for absences

  // 2. Calculate Punctuality Score
  const punctualityRate = attendance.totalDays > 0 ? 
    ((attendance.totalDays - attendance.lateDays) / attendance.totalDays) * 100 : 100
  
  healthScore.metrics.punctualityRate = punctualityRate
  healthScore.punctualityScore = Math.max(0, punctualityRate - (attendance.lateDays * 1.5)) // Penalty for late arrivals

  // 3. Calculate Performance Score
  const performanceData = await Performance.find({
    employee: employeeId,
    createdAt: { $gte: threeMonthsAgo }
  }).sort({ createdAt: -1 }).limit(3)

  if (performanceData.length > 0) {
    const avgRating = performanceData.reduce((sum, perf) => sum + perf.overallRating, 0) / performanceData.length
    healthScore.metrics.averagePerformanceRating = avgRating
    healthScore.performanceScore = (avgRating / 5) * 100 // Convert 5-point scale to percentage
  }

  // 4. Calculate Leave Score
  const leaveData = await Leave.find({
    employee: employeeId,
    createdAt: { $gte: threeMonthsAgo },
    status: { $in: ['approved', 'rejected'] }
  })

  const unapprovedLeaves = leaveData.filter(leave => leave.status === 'rejected').length
  healthScore.metrics.unapprovedLeaves = unapprovedLeaves
  healthScore.leaveScore = Math.max(0, 100 - (unapprovedLeaves * 10)) // Penalty for rejected leaves

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
  healthScore.saveToHistory(`Calculated on ${now.toDateString()}`)

  // 8. Update last calculated time
  healthScore.metrics.lastCalculated = now

  await healthScore.save()
  return healthScore
}
