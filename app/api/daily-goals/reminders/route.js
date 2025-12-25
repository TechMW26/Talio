import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'

// POST - Send daily goal reminders
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded || !['admin', 'hr', 'system'].includes(decoded.role)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 403 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['DailyGoal', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { DailyGoal, Employee } = models

    const { reminderType, employeeIds } = await request.json()
    
    const today = new Date()
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

    let query = { status: 'active' }
    if (employeeIds && employeeIds.length > 0) {
      query._id = { $in: employeeIds }
    }

    const employees = await Employee.find(query)
    
    const results = {
      processed: 0,
      remindersSent: 0,
      errors: 0,
      reminderType,
      details: []
    }

    for (const employee of employees) {
      try {
        results.processed++
        
        // Find today's goals
        let dailyGoal = await DailyGoal.findOne({
          employee: employee._id,
          date: { $gte: todayStart, $lt: todayEnd }
        })

        let shouldSendReminder = false
        let reminderMessage = ''

        switch (reminderType) {
          case 'morning':
            // Morning reminder to set goals
            if (!dailyGoal || dailyGoal.goals.length === 0) {
              shouldSendReminder = !dailyGoal?.reminders?.morningReminderSent
              reminderMessage = `Good morning ${employee.firstName}! Don't forget to set your daily goals for today.`
            }
            break

          case 'evening':
            // Evening reminder to update progress
            if (dailyGoal && dailyGoal.goals.length > 0) {
              const incompleteGoals = dailyGoal.goals.filter(g => 
                g.status !== 'completed' && g.status !== 'cancelled'
              ).length
              
              if (incompleteGoals > 0) {
                shouldSendReminder = !dailyGoal.reminders?.eveningReminderSent
                reminderMessage = `Hi ${employee.firstName}! You have ${incompleteGoals} pending goals. Please update your progress.`
              }
            }
            break

          case 'cutoff':
            // 6:45 PM cutoff reminder
            const now = new Date()
            const cutoffTime = new Date()
            cutoffTime.setHours(18, 45, 0, 0)
            
            if (now >= cutoffTime) {
              if (!dailyGoal || dailyGoal.goals.length === 0) {
                shouldSendReminder = !dailyGoal?.reminders?.cutoffReminderSent
                reminderMessage = `URGENT: ${employee.firstName}, you haven't set your daily goals. This may impact your salary. Please set them immediately.`
              } else {
                const incompleteGoals = dailyGoal.goals.filter(g => 
                  g.status !== 'completed' && g.status !== 'cancelled'
                ).length
                
                if (incompleteGoals > 0) {
                  shouldSendReminder = !dailyGoal.reminders?.cutoffReminderSent
                  reminderMessage = `URGENT: ${employee.firstName}, you have ${incompleteGoals} incomplete goals. Please update them before end of day to avoid salary impact.`
                }
              }
            }
            break

          case 'manager':
            // Manager notification for team goals
            if (employee.reportingManager) {
              const teamMembers = await Employee.find({ 
                reportingManager: employee._id,
                status: 'active'
              })
              
              if (teamMembers.length > 0) {
                const teamGoalsData = await DailyGoal.find({
                  employee: { $in: teamMembers.map(m => m._id) },
                  date: { $gte: todayStart, $lt: todayEnd }
                }).populate('employee', 'firstName lastName')

                const teamSummary = {
                  totalMembers: teamMembers.length,
                  goalsSet: teamGoalsData.length,
                  avgCompletionRate: 0,
                  pendingGoals: 0
                }

                if (teamGoalsData.length > 0) {
                  const totalCompletionRate = teamGoalsData.reduce((sum, goal) => 
                    sum + goal.summary.completionRate, 0)
                  teamSummary.avgCompletionRate = (totalCompletionRate / teamGoalsData.length).toFixed(1)
                  
                  teamSummary.pendingGoals = teamGoalsData.reduce((sum, goal) => 
                    sum + goal.summary.inProgressGoals, 0)
                }

                shouldSendReminder = true
                reminderMessage = `Team Goals Summary: ${teamSummary.goalsSet}/${teamSummary.totalMembers} members set goals. Avg completion: ${teamSummary.avgCompletionRate}%. Pending: ${teamSummary.pendingGoals} goals.`
              }
            }
            break
        }

        if (shouldSendReminder) {
          // Create or update daily goal record
          if (!dailyGoal) {
            dailyGoal = new DailyGoal({
              employee: employee._id,
              date: todayStart,
              goals: []
            })
          }

          // Mark reminder as sent
          if (!dailyGoal.reminders) {
            dailyGoal.reminders = {}
          }

          switch (reminderType) {
            case 'morning':
              dailyGoal.reminders.morningReminderSent = true
              break
            case 'evening':
              dailyGoal.reminders.eveningReminderSent = true
              break
            case 'cutoff':
              dailyGoal.reminders.cutoffReminderSent = true
              break
            case 'manager':
              dailyGoal.reminders.managerNotificationSent = true
              break
          }

          await dailyGoal.save()

          // Here you would integrate with your notification service
          // For now, we'll just log the reminder
          console.log(`Reminder sent to ${employee.firstName} ${employee.lastName}: ${reminderMessage}`)

          results.remindersSent++
          results.details.push({
            employeeId: employee._id,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            message: reminderMessage,
            sentAt: new Date()
          })
        }

      } catch (error) {
        console.error(`Error sending reminder to employee ${employee._id}:`, error)
        results.errors++
      }
    }

    return NextResponse.json({
      success: true,
      message: `Sent ${results.remindersSent} reminders out of ${results.processed} employees`,
      data: results
    })

  } catch (error) {
    console.error('Send daily goal reminders error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to send reminders' },
      { status: 500 }
    )
  }
}

// GET - Get reminder status for today
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

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId') || decoded.userId

    const today = new Date()
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

    const dailyGoal = await DailyGoal.findOne({
      employee: employeeId,
      date: { $gte: todayStart, $lt: todayEnd }
    })

    const reminderStatus = {
      morningReminderSent: dailyGoal?.reminders?.morningReminderSent || false,
      eveningReminderSent: dailyGoal?.reminders?.eveningReminderSent || false,
      cutoffReminderSent: dailyGoal?.reminders?.cutoffReminderSent || false,
      managerNotificationSent: dailyGoal?.reminders?.managerNotificationSent || false,
      goalsSet: dailyGoal?.goals?.length || 0,
      completionRate: dailyGoal?.summary?.completionRate || 0,
      isLocked: dailyGoal?.submissionStatus?.isLocked || false
    }

    // Check if cutoff time has passed
    const now = new Date()
    const cutoffTime = new Date()
    cutoffTime.setHours(18, 45, 0, 0)
    reminderStatus.pastCutoff = now > cutoffTime

    return NextResponse.json({
      success: true,
      data: reminderStatus
    })

  } catch (error) {
    console.error('Get reminder status error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to get reminder status' },
      { status: 500 }
    )
  }
}
