import mongoose from 'mongoose'

const RecurringNotificationSchema = new mongoose.Schema({
  // Notification content
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  url: {
    type: String,
    default: '/dashboard'
  },
  icon: {
    type: String
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Targeting
  targetType: {
    type: String,
    enum: ['all', 'department', 'specific', 'role'],
    required: true
  },
  targetDepartment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  },
  targetUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  targetRoles: [{
    type: String
  }],

  // Recurrence settings
  frequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'custom'],
    required: true
  },

  // For daily frequency
  dailyTime: {
    type: String, // Format: "HH:MM" (24-hour)
  },

  // For weekly frequency
  weeklyDays: [{
    type: String,
    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  }],
  weeklyTime: {
    type: String, // Format: "HH:MM" (24-hour)
  },

  // For monthly frequency
  monthlyDay: {
    type: Number, // Day of month (1-31)
    min: 1,
    max: 31
  },
  monthlyTime: {
    type: String, // Format: "HH:MM" (24-hour)
  },

  // For custom frequency (cron-like)
  customDays: [{
    type: String,
    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  }],
  customTimes: [{
    type: String // Format: "HH:MM" (24-hour)
  }],

  // Schedule period
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date
  },
  timezone: {
    type: String,
    default: 'Asia/Kolkata'
  },

  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  lastSentAt: {
    type: Date
  },
  nextScheduledAt: {
    type: Date
  },
  totalSent: {
    type: Number,
    default: 0
  },
  totalSuccess: {
    type: Number,
    default: 0
  },
  totalFailure: {
    type: Number,
    default: 0
  },

  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  createdByRole: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
})

// Index for efficient querying
RecurringNotificationSchema.index({ nextScheduledAt: 1, isActive: 1 })
RecurringNotificationSchema.index({ createdBy: 1 })
RecurringNotificationSchema.index({ isActive: 1 })

// Method to calculate next scheduled time
RecurringNotificationSchema.methods.calculateNextSchedule = function () {
  const now = new Date()

  // If end date is passed, deactivate
  if (this.endDate && now > this.endDate) {
    this.isActive = false
    return null
  }

  // If start date is in future, use start date with proper time
  if (this.startDate > now) {
    const startDate = new Date(this.startDate)
    // Set the time based on frequency type
    if (this.frequency === 'daily' && this.dailyTime) {
      const [hours, minutes] = this.dailyTime.split(':')
      startDate.setHours(parseInt(hours), parseInt(minutes), 0, 0)
    } else if (this.frequency === 'weekly' && this.weeklyTime) {
      const [hours, minutes] = this.weeklyTime.split(':')
      startDate.setHours(parseInt(hours), parseInt(minutes), 0, 0)
    } else if (this.frequency === 'monthly' && this.monthlyTime) {
      const [hours, minutes] = this.monthlyTime.split(':')
      startDate.setHours(parseInt(hours), parseInt(minutes), 0, 0)
    }
    return startDate
  }

  let nextDate = new Date(now)

  switch (this.frequency) {
    case 'daily':
      if (this.dailyTime) {
        const [hours, minutes] = this.dailyTime.split(':')
        nextDate.setHours(parseInt(hours), parseInt(minutes), 0, 0)

        // If time has passed today, schedule for tomorrow
        if (nextDate <= now) {
          nextDate.setDate(nextDate.getDate() + 1)
        }
      } else {
        // Default: next occurrence in 24 hours
        nextDate.setDate(nextDate.getDate() + 1)
      }
      break

    case 'weekly':
      if (this.weeklyDays && this.weeklyDays.length > 0) {
        const timeStr = this.weeklyTime || '09:00'
        const [hours, minutes] = timeStr.split(':')
        const dayMap = {
          sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
          thursday: 4, friday: 5, saturday: 6
        }

        const currentDay = now.getDay()
        const currentTimeMinutes = now.getHours() * 60 + now.getMinutes()
        const targetTimeMinutes = parseInt(hours) * 60 + parseInt(minutes)
        const targetDays = this.weeklyDays.map(d => dayMap[d]).sort((a, b) => a - b)

        let daysToAdd = null

        // Check if any target day is today and time hasn't passed
        for (const targetDay of targetDays) {
          if (targetDay === currentDay && currentTimeMinutes < targetTimeMinutes) {
            daysToAdd = 0
            break
          } else if (targetDay > currentDay) {
            daysToAdd = targetDay - currentDay
            break
          }
        }

        // If no day found this week, use first day of next week
        if (daysToAdd === null) {
          daysToAdd = 7 - currentDay + targetDays[0]
        }

        nextDate.setDate(nextDate.getDate() + daysToAdd)
        nextDate.setHours(parseInt(hours), parseInt(minutes), 0, 0)
      } else {
        // Default: next week same day
        nextDate.setDate(nextDate.getDate() + 7)
      }
      break

    case 'monthly':
      if (this.monthlyDay) {
        const timeStr = this.monthlyTime || '09:00'
        const [hours, minutes] = timeStr.split(':')
        const targetDay = this.monthlyDay

        nextDate.setDate(targetDay)
        nextDate.setHours(parseInt(hours), parseInt(minutes), 0, 0)

        // If date has passed this month, schedule for next month
        if (nextDate <= now) {
          nextDate.setMonth(nextDate.getMonth() + 1)
          nextDate.setDate(targetDay)
        }

        // Handle months with fewer days
        const maxDays = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate()
        if (targetDay > maxDays) {
          nextDate.setDate(maxDays)
        }
      } else {
        // Default: next month same day
        nextDate.setMonth(nextDate.getMonth() + 1)
      }
      break

    case 'custom':
      if (this.customDays && this.customDays.length > 0 && this.customTimes && this.customTimes.length > 0) {
        const [hours, minutes] = this.customTimes[0].split(':')
        const dayMap = {
          sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
          thursday: 4, friday: 5, saturday: 6
        }

        const currentDay = nextDate.getDay()
        const currentTimeMinutes = now.getHours() * 60 + now.getMinutes()
        const targetTimeMinutes = parseInt(hours) * 60 + parseInt(minutes)
        const targetDays = this.customDays.map(d => dayMap[d]).sort((a, b) => a - b)

        let daysToAdd = null

        for (const targetDay of targetDays) {
          if (targetDay === currentDay && currentTimeMinutes < targetTimeMinutes) {
            daysToAdd = 0
            break
          } else if (targetDay > currentDay) {
            daysToAdd = targetDay - currentDay
            break
          }
        }

        if (daysToAdd === null) {
          daysToAdd = 7 - currentDay + targetDays[0]
        }

        nextDate.setDate(nextDate.getDate() + daysToAdd)
        nextDate.setHours(parseInt(hours), parseInt(minutes), 0, 0)
      } else {
        // Default: tomorrow
        nextDate.setDate(nextDate.getDate() + 1)
      }
      break

    default:
      // Unknown frequency, default to tomorrow
      nextDate.setDate(nextDate.getDate() + 1)
  }

  return nextDate
}

export default mongoose.models.RecurringNotification || mongoose.model('RecurringNotification', RecurringNotificationSchema)

