import mongoose from 'mongoose'

const NotificationSchema = new mongoose.Schema({
  // Recipient
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Content
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

  // Type and category
  type: {
    type: String,
    enum: ['custom', 'task', 'leave', 'attendance', 'announcement', 'system', 'chat', 'approval', 'scheduled', 'recurring'],
    default: 'custom'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },

  // Status
  read: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  },

  // Delivery status
  deliveryStatus: {
    fcm: {
      sent: { type: Boolean, default: false },
      sentAt: { type: Date }
    },
    socketIO: {
      sent: { type: Boolean, default: false },
      sentAt: { type: Date }
    }
  },

  // Metadata
  sentBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  sentByRole: {
    type: String
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  expiresAt: {
    type: Date
    // No index:true here - TTL index below creates the index
  }
}, {
  timestamps: true
})

// Index for efficient queries
NotificationSchema.index({ user: 1, createdAt: -1 })
NotificationSchema.index({ user: 1, read: 1 })
// TTL index for auto-expiring notifications
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

// Virtual for checking if notification is expired
NotificationSchema.virtual('isExpired').get(function () {
  return this.expiresAt && this.expiresAt < new Date()
})

// Method to mark as read
NotificationSchema.methods.markAsRead = async function () {
  this.read = true
  this.readAt = new Date()
  return await this.save()
}

// Static method to mark multiple as read
NotificationSchema.statics.markManyAsRead = async function (notificationIds, userId) {
  return await this.updateMany(
    { _id: { $in: notificationIds }, user: userId },
    { read: true, readAt: new Date() }
  )
}

// Static method to get unread count
NotificationSchema.statics.getUnreadCount = async function (userId) {
  return await this.countDocuments({ user: userId, read: false })
}

// Static method to delete old read notifications
NotificationSchema.statics.deleteOldReadNotifications = async function (daysOld = 30) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)

  return await this.deleteMany({
    read: true,
    readAt: { $lt: cutoffDate }
  })
}

export default mongoose.models.Notification || mongoose.model('Notification', NotificationSchema)

