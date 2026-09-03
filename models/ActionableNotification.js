import mongoose from 'mongoose'

/**
 * ActionableNotification Model
 * 
 * Persistent notifications that require user action (accept/reject/view/etc.)
 * These notifications persist across sessions until the user takes action or dismisses them.
 * 
 * Use cases:
 * - Project invitations (accept/reject)
 * - Task assignments (accept/reject)
 * - Meeting invitations (accept/decline/tentative)
 * - Leave approval requests (approve/reject)
 * - Document approvals
 * - Any notification requiring explicit user response
 */
const ActionableNotificationSchema = new mongoose.Schema({
  // Recipient user
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Notification content
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  icon: {
    type: String,
    default: '🔔'
  },

  // Type determines available actions
  type: {
    type: String,
    enum: [
      'project_invitation',    // Accept/Reject project membership
      'task_assignment',       // Accept/Reject task
      'meeting_invitation',    // Accept/Decline/Tentative
      'leave_approval',        // Approve/Reject leave request
      'expense_approval',      // Approve/Reject expense
      'document_approval',     // Approve/Reject document
      'travel_approval',       // Approve/Reject travel request
      'attendance_correction', // Approve/Reject correction
      'helpdesk_assignment',   // Acknowledge ticket assignment
      'announcement',          // Acknowledge/View announcement
      'probation_approval',     // Approve/Reject probation confirmation or extension
      'generic'                // Custom actions
    ],
    required: true,
    index: true
  },

  // Priority for display order
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },

  // Status tracking
  status: {
    type: String,
    enum: ['pending', 'actioned', 'dismissed', 'expired'],
    default: 'pending',
    index: true
  },

  // Action taken (if any)
  actionTaken: {
    action: String,       // e.g., 'accepted', 'rejected', 'dismissed'
    takenAt: Date,
    reason: String        // Optional reason for rejection/decline
  },

  // Reference to related entity
  reference: {
    model: {
      type: String,
      enum: ['Project', 'Task', 'Meeting', 'Leave', 'Expense', 'Travel', 'Document', 'Attendance', 'Helpdesk', 'Announcement', 'ProbationApproval']
    },
    id: {
      type: mongoose.Schema.Types.ObjectId
    }
  },

  // API endpoints for actions (allows dynamic action handling)
  actions: [{
    id: {
      type: String,
      required: true
    },
    label: {
      type: String,
      required: true
    },
    variant: {
      type: String,
      enum: ['primary', 'secondary', 'danger', 'success', 'warning'],
      default: 'primary'
    },
    // API endpoint to call when action is taken
    endpoint: String,
    method: {
      type: String,
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      default: 'POST'
    },
    // Body to send with the request
    payload: mongoose.Schema.Types.Mixed,
    // Whether this action requires confirmation
    requiresConfirmation: {
      type: Boolean,
      default: false
    },
    // Confirmation message
    confirmationMessage: String,
    // Whether this action requires a reason
    requiresReason: {
      type: Boolean,
      default: false
    },
    // Reason prompt text
    reasonPrompt: String
  }],

  // Navigation URL (for "View" action)
  url: String,

  // Additional metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Creator info
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },

  // Expiration
  expiresAt: {
    type: Date
  },

  // Display settings
  displaySettings: {
    persistent: {
      type: Boolean,
      default: true  // Stay visible until action taken
    },
    showInBell: {
      type: Boolean,
      default: true  // Show in notification bell
    },
    playSound: {
      type: Boolean,
      default: true
    },
    dismissible: {
      type: Boolean,
      default: true
    }
  }
}, {
  timestamps: true
})

// Compound indexes for efficient queries
ActionableNotificationSchema.index({ user: 1, status: 1, createdAt: -1 })
ActionableNotificationSchema.index({ user: 1, type: 1, status: 1 })
ActionableNotificationSchema.index({ 'reference.model': 1, 'reference.id': 1 })

// TTL index for auto-expiring notifications (if expiresAt is set)
ActionableNotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

// Virtual to check if notification is actionable
ActionableNotificationSchema.virtual('isActionable').get(function() {
  return this.status === 'pending' && this.actions && this.actions.length > 0
})

// Virtual to check if expired
ActionableNotificationSchema.virtual('isExpired').get(function() {
  return this.expiresAt && this.expiresAt < new Date()
})

// Mark notification as actioned
ActionableNotificationSchema.methods.markAsActioned = async function(action, reason = null) {
  this.status = 'actioned'
  this.actionTaken = {
    action,
    takenAt: new Date(),
    reason
  }
  return await this.save()
}

// Mark notification as dismissed
ActionableNotificationSchema.methods.dismiss = async function() {
  this.status = 'dismissed'
  this.actionTaken = {
    action: 'dismissed',
    takenAt: new Date()
  }
  return await this.save()
}

// Static method to get pending notifications for a user
ActionableNotificationSchema.statics.getPendingForUser = async function(userId, options = {}) {
  const query = {
    user: userId,
    status: 'pending'
  }

  if (options.type) {
    query.type = options.type
  }

  return await this.find(query)
    .sort({ priority: -1, createdAt: -1 })
    .limit(options.limit || 50)
    .populate('createdBy', 'firstName lastName')
}

// Static method to find by reference
ActionableNotificationSchema.statics.findByReference = async function(model, id, userId = null) {
  const query = {
    'reference.model': model,
    'reference.id': id
  }
  
  if (userId) {
    query.user = userId
  }
  
  return await this.find(query)
}

// Static method to dismiss all of a type for user
ActionableNotificationSchema.statics.dismissAllOfType = async function(userId, type) {
  return await this.updateMany(
    { user: userId, type, status: 'pending' },
    { 
      status: 'dismissed',
      'actionTaken.action': 'dismissed',
      'actionTaken.takenAt': new Date()
    }
  )
}

// Pre-save hook to auto-expire if past expiresAt
ActionableNotificationSchema.pre('save', function(next) {
  if (this.expiresAt && this.expiresAt < new Date() && this.status === 'pending') {
    this.status = 'expired'
  }
  next()
})

export default mongoose.models.ActionableNotification || mongoose.model('ActionableNotification', ActionableNotificationSchema)
