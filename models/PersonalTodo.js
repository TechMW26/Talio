import mongoose from 'mongoose'

const PersonalTodoSchema = new mongoose.Schema({
  // Owner of the todo
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  // Todo content
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  description: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  // Category/Tab
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TodoCategory'
  },
  // Status
  status: {
    type: String,
    enum: ['pending', 'completed'],
    default: 'pending'
  },
  completedAt: Date,
  // Priority
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  // Dates
  dueDate: Date,
  dueTime: String, // HH:mm format
  // Reminders
  reminders: [{
    type: {
      type: String,
      enum: ['15min', '30min', '1hour', '1day', 'custom'],
    },
    customMinutes: Number, // For custom reminders
    sent: {
      type: Boolean,
      default: false
    },
    sentAt: Date,
    // Track which channels were used
    emailSent: { type: Boolean, default: false },
    pushSent: { type: Boolean, default: false },
    mobileSent: { type: Boolean, default: false }
  }],
  // Subtasks
  subtasks: [{
    title: {
      type: String,
      required: true,
      trim: true
    },
    completed: {
      type: Boolean,
      default: false
    },
    completedAt: Date
  }],
  // Notes/Comments
  notes: String,
  // Tags for additional filtering
  tags: [String],
  // Recurrence settings
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurrence: {
    pattern: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'yearly']
    },
    interval: {
      type: Number,
      default: 1
    },
    endDate: Date,
    daysOfWeek: [Number], // 0-6 for weekly recurrence
    dayOfMonth: Number // For monthly recurrence
  },
  // Analytics tracking
  analytics: {
    // Time spent on this todo (manually logged or from timer)
    timeSpent: {
      type: Number, // in minutes
      default: 0
    },
    // Number of times the due date was extended
    dueDateExtensions: {
      type: Number,
      default: 0
    },
    // Track if completed on time
    completedOnTime: Boolean,
    // Days overdue when completed (negative means early)
    daysOverdue: Number,
    // Creation to completion time in hours
    completionTime: Number
  },
  // Ordering within category
  order: {
    type: Number,
    default: 0
  },
  // Soft delete
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date
}, {
  timestamps: true
})

// Indexes
PersonalTodoSchema.index({ user: 1, status: 1, isDeleted: 1 })
PersonalTodoSchema.index({ user: 1, category: 1, isDeleted: 1 })
PersonalTodoSchema.index({ user: 1, dueDate: 1, isDeleted: 1 })
PersonalTodoSchema.index({ employee: 1, status: 1 })
PersonalTodoSchema.index({ 'reminders.sent': 1, dueDate: 1 }) // For reminder cron
PersonalTodoSchema.index({ createdAt: -1 })

// Virtual for checking if overdue
PersonalTodoSchema.virtual('isOverdue').get(function() {
  if (this.status === 'completed' || !this.dueDate) return false
  return new Date() > new Date(this.dueDate)
})

// Virtual for days until due
PersonalTodoSchema.virtual('daysUntilDue').get(function() {
  if (!this.dueDate) return null
  const now = new Date()
  const due = new Date(this.dueDate)
  const diffTime = due - now
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
})

// Pre-save hook to update analytics on completion
PersonalTodoSchema.pre('save', function(next) {
  if (this.isModified('status') && this.status === 'completed' && !this.completedAt) {
    this.completedAt = new Date()
    
    // Calculate analytics
    if (this.dueDate) {
      const due = new Date(this.dueDate)
      const completed = this.completedAt
      this.analytics.completedOnTime = completed <= due
      this.analytics.daysOverdue = Math.ceil((completed - due) / (1000 * 60 * 60 * 24))
    }
    
    // Calculate completion time in hours
    const createdAt = this.createdAt || new Date()
    this.analytics.completionTime = Math.round((this.completedAt - createdAt) / (1000 * 60 * 60))
  }
  next()
})

export default mongoose.models.PersonalTodo || mongoose.model('PersonalTodo', PersonalTodoSchema)
