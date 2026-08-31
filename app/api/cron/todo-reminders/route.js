import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import mongoose from 'mongoose'
import { sendNotificationToMultipleDevices } from '@/lib/firebaseNotification'
import { getCronAuthErrorResponse } from '@/lib/cronAuth'

// Import schemas directly for cron job (runs without user context)
const PersonalTodoSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  title: { type: String, required: true },
  description: String,
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'TodoCategory' },
  status: { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
  priority: { type: String, enum: ['none', 'low', 'medium', 'high'], default: 'none' },
  dueDate: Date,
  dueTime: String,
  reminders: [{
    time: Date,
    type: { type: String, enum: ['email', 'push', 'mobile'], default: 'push' },
    sent: { type: Boolean, default: false },
    sentAt: Date
  }],
  subtasks: [{
    title: String,
    completed: { type: Boolean, default: false },
    completedAt: Date
  }],
  notes: String,
  tags: [String],
  completedAt: Date,
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date,
  order: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true })

/**
 * Cron Job: Process Todo Reminders
 * Sends push notifications for todos with due reminders
 * Should be called every 5 minutes by a cron service
 */
export async function GET(request) {
  try {
    const authError = getCronAuthErrorResponse(request)
    if (authError) return authError

    await connectDB()

    // Get current time window (last 10 minutes to account for any delays)
    const now = new Date()
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000)

    // Find all tenant databases
    const adminDb = mongoose.connection.db.admin()
    const { databases } = await adminDb.listDatabases()
    
    const tenantDbs = databases.filter(db => 
      db.name.startsWith('talio_') && 
      db.name !== 'talio_admin' &&
      db.name !== 'talio_platform'
    )

    let totalProcessed = 0
    let totalSent = 0

    // Process each tenant database
    for (const dbInfo of tenantDbs) {
      try {
        const tenantConnection = mongoose.connection.useDb(dbInfo.name)
        
        // Get or create the PersonalTodo model for this tenant
        let PersonalTodo
        try {
          PersonalTodo = tenantConnection.model('PersonalTodo')
        } catch {
          PersonalTodo = tenantConnection.model('PersonalTodo', PersonalTodoSchema)
        }

        // Find todos with unsent reminders that are due
        const todosWithDueReminders = await PersonalTodo.find({
          isDeleted: false,
          status: { $ne: 'completed' },
          'reminders.sent': false,
          'reminders.time': { $lte: now, $gte: tenMinutesAgo }
        }).populate('user', 'email fcmTokens')

        for (const todo of todosWithDueReminders) {
          const dueReminders = todo.reminders.filter(r => 
            !r.sent && 
            new Date(r.time) <= now && 
            new Date(r.time) >= tenMinutesAgo
          )

          for (const reminder of dueReminders) {
            totalProcessed++

            // Send push notification
            if (todo.user?.fcmTokens?.length > 0) {
              try {
                const tokens = todo.user.fcmTokens.map(t => t.token).filter(Boolean)
                if (tokens.length > 0) {
                  await sendNotificationToMultipleDevices(
                    tokens,
                    {
                      title: '⏰ Task Reminder',
                      body: todo.title
                    },
                    {
                      type: 'task_reminder',
                      taskId: todo._id.toString(),
                      url: '/dashboard/todo'
                    }
                  )
                  totalSent++
                }
              } catch (pushError) {
                console.error(`[Todo Reminders] Failed to send push for todo ${todo._id}:`, pushError.message)
              }
            }

            // Mark reminder as sent
            reminder.sent = true
            reminder.sentAt = now
          }

          // Save the updated todo
          await todo.save()
        }
      } catch (tenantError) {
        console.error(`[Todo Reminders] Error processing tenant ${dbInfo.name}:`, tenantError.message)
      }
    }

    console.log(`[Todo Reminders] Processed ${totalProcessed} reminders, sent ${totalSent} notifications`)

    return NextResponse.json({
      success: true,
      message: 'Reminders processed',
      data: {
        processed: totalProcessed,
        sent: totalSent,
        tenants: tenantDbs.length
      }
    })

  } catch (error) {
    console.error('[Todo Reminders] Cron job error:', error)
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    )
  }
}
