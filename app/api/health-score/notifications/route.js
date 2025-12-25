import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'

// GET - Get health score notifications for employee
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
    const auth = await getAuthAndModels(request, ['HealthScore', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { HealthScore, Employee } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId') || decoded.userId

    // Check if user can access this employee's data
    if (decoded.role === 'employee' && employeeId !== decoded.userId) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 403 })
    }

    const healthScore = await HealthScore.findOne({ employee: employeeId })
      .populate('employee', 'firstName lastName employeeCode')

    if (!healthScore) {
      return NextResponse.json({
        success: true,
        data: {
          notifications: [],
          riskLevel: 'low',
          salaryDeductionRisk: false
        }
      })
    }

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
        id: `warning_${index}`,
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
    if (healthScore.improvementPlan.isActive) {
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
        lastUpdated: healthScore.metrics.lastCalculated
      }
    })

  } catch (error) {
    console.error('Get health score notifications error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch notifications' },
      { status: 500 }
    )
  }
}

// POST - Acknowledge notification/warning
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const { employeeId, warningId, acknowledgeAll = false } = await request.json()
    const targetEmployeeId = employeeId || decoded.userId

    // Check if user can access this employee's data
    if (decoded.role === 'employee' && targetEmployeeId !== decoded.userId) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 403 })
    }

    const healthScore = await HealthScore.findOne({ employee: targetEmployeeId })
    if (!healthScore) {
      return NextResponse.json({ success: false, message: 'Health score not found' }, { status: 404 })
    }

    if (acknowledgeAll) {
      // Acknowledge all warnings
      healthScore.warnings.forEach(warning => {
        warning.acknowledged = true
      })
    } else if (warningId) {
      // Acknowledge specific warning
      const warning = healthScore.warnings.id(warningId)
      if (warning) {
        warning.acknowledged = true
      }
    }

    await healthScore.save()

    return NextResponse.json({
      success: true,
      message: 'Notification acknowledged'
    })

  } catch (error) {
    console.error('Acknowledge notification error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to acknowledge notification' },
      { status: 500 }
    )
  }
}
