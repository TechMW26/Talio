import mongoose from 'mongoose'

const ScheduledNotificationSchema = new mongoose.Schema({
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

  // Scheduling
  scheduledFor: {
    type: Date,
    required: true
  },
  timezone: {
    type: String,
    default: 'Asia/Kolkata'
  },

  // Status
  status: {
    type: String,
    enum: ['pending', 'sent', 'failed', 'cancelled'],
    default: 'pending'
  },
  sentAt: {
    type: Date
  },
  recipientCount: {
    type: Number,
    default: 0
  },
  successCount: {
    type: Number,
    default: 0
  },
  failureCount: {
    type: Number,
    default: 0
  },
  error: {
    type: String
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
ScheduledNotificationSchema.index({ scheduledFor: 1, status: 1 })
ScheduledNotificationSchema.index({ createdBy: 1 })
ScheduledNotificationSchema.index({ status: 1 })

export default mongoose.models.ScheduledNotification || mongoose.model('ScheduledNotification', ScheduledNotificationSchema)

