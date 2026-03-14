import mongoose from 'mongoose';

/**
 * Task Attachment Schema
 * Separate schema for task attachments to ensure proper type handling
 */
const TaskAttachmentSchema = new mongoose.Schema({
  name: String,
  url: String,
  type: String,
  size: Number,
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const TaskSchema = new mongoose.Schema({
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: false
  },
  title: {
    type: String,
    required: [true, 'Task title is required'],
    trim: true,
    maxlength: [300, 'Task title cannot exceed 300 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [3000, 'Description cannot exceed 3000 characters']
  },
  status: {
    type: String,
    enum: ['todo', 'in-progress', 'review', 'completed', 'completed-pending-approval', 'rejected', 'blocked', 'archived'],
    default: 'todo'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  dueDate: {
    type: Date
  },
  startDate: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  // Rejection tracking
  lastRejectedAt: {
    type: Date
  },
  lastRejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  rejectionCount: {
    type: Number,
    default: 0
  },
  lastRejectionReason: {
    type: String,
    trim: true
  },
  // Subtasks/micro tasks for granular progress tracking
  subtasks: [{
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
      auto: true
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: [200, 'Subtask title cannot exceed 200 characters']
    },
    completed: {
      type: Boolean,
      default: false
    },
    completedAt: {
      type: Date
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    // Multi-assignee acceptance tracking
    // When one assignee marks subtask complete, others must accept
    pendingAcceptance: {
      type: Boolean,
      default: false
    },
    // List of employee IDs who have accepted this subtask completion
    acceptedBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    }],
    // List of employee IDs who rejected this subtask completion
    rejectedBy: [{
      employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
      },
      reason: String,
      rejectedAt: {
        type: Date,
        default: Date.now
      }
    }],
    // Subtask-level ETA for accurate tracking
    estimatedDays: {
      type: Number,
      default: 0,
      min: 0
    },
    estimatedHours: {
      type: Number,
      default: 0,
      min: 0,
      max: 23
    },
    order: {
      type: Number,
      default: 0
    },
    // Subtask comments from assignee, project head, etc.
    comments: [{
      _id: {
        type: mongoose.Schema.Types.ObjectId,
        default: () => new mongoose.Types.ObjectId(),
        auto: true
      },
      text: {
        type: String,
        required: true,
        trim: true,
        maxlength: [500, 'Comment cannot exceed 500 characters']
      },
      author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
      },
      authorRole: {
        type: String,
        enum: ['assignee', 'project_head', 'admin', 'creator', 'other'],
        default: 'other'
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Progress percentage based on subtasks (0-100)
  progressPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  estimatedHours: {
    type: Number,
    min: 0
  },
  actualHours: {
    type: Number,
    min: 0
  },
  // Deletion request - requires approval from assignee or project head
  deletionRequest: {
    status: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none'
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    requestedAt: {
      type: Date
    },
    reason: {
      type: String,
      trim: true
    },
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    respondedAt: {
      type: Date
    },
    rejectionReason: {
      type: String,
      trim: true
    }
  },
  // Tags for categorization
  tags: [{
    type: String,
    trim: true
  }],
  // Order/position within project (for drag-drop)
  order: {
    type: Number,
    default: 0
  },
  // Parent task for sub-task support (future extensibility)
  parentTask: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task'
  },
  // Attachments
  attachments: [TaskAttachmentSchema],
  // Metadata for additional info
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for assignees
TaskSchema.virtual('assignees', {
  ref: 'TaskAssignee',
  localField: '_id',
  foreignField: 'task'
});

// Virtual for sub-tasks
TaskSchema.virtual('subTasks', {
  ref: 'Task',
  localField: '_id',
  foreignField: 'parentTask'
});

// Virtual to check if task is overdue
TaskSchema.virtual('isOverdue').get(function() {
  if (['completed', 'archived'].includes(this.status)) {
    return false;
  }
  if (!this.dueDate) return false;
  return new Date() > this.dueDate;
});

// Indexes for performance
TaskSchema.index({ project: 1, status: 1 });
TaskSchema.index({ project: 1, createdAt: -1 });
TaskSchema.index({ createdBy: 1 });
TaskSchema.index({ dueDate: 1, status: 1 });
TaskSchema.index({ parentTask: 1 });
TaskSchema.index({ title: 'text', description: 'text' });

export default mongoose.models.Task || mongoose.model('Task', TaskSchema);
