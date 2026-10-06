import mongoose from 'mongoose';
import { DEFAULT_TASK_STATUSES } from '@/lib/taskStatusConfig';

const ProjectTaskStatusSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    trim: true
  },
  label: {
    type: String,
    required: true,
    trim: true,
    maxlength: [60, 'Status label cannot exceed 60 characters']
  },
  color: {
    type: String,
    default: 'gray'
  },
  order: {
    type: Number,
    default: 0
  },
  isSystem: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const ProjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Project name is required'],
    trim: true,
    maxlength: [200, 'Project name cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  status: {
    type: String,
    enum: ['planned', 'ongoing', 'completed', 'pending', 'overdue', 'archived', 'completed_pending_approval', 'approved', 'rejected'],
    default: 'planned'
  },
  startDate: {
    type: Date,
    required: [true, 'Start date is required']
  },
  endDate: {
    type: Date,
    required: [true, 'End date/deadline is required']
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  projectHeads: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  }],
  projectHead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  completionPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  chatGroup: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat'
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  tags: [{
    type: String,
    trim: true
  }],
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  taskStatuses: {
    type: [ProjectTaskStatusSchema],
    default: () => DEFAULT_TASK_STATUSES.map(s => ({ ...s }))
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

ProjectSchema.virtual('members', {
  ref: 'ProjectMember',
  localField: '_id',
  foreignField: 'project'
});

ProjectSchema.virtual('tasks', {
  ref: 'Task',
  localField: '_id',
  foreignField: 'project'
});

ProjectSchema.virtual('timelineEvents', {
  ref: 'ProjectTimelineEvent',
  localField: '_id',
  foreignField: 'project'
});

ProjectSchema.virtual('isOverdue').get(function() {
  if (['completed', 'approved', 'archived'].includes(this.status)) {
    return false;
  }
  return new Date() > this.endDate;
});

ProjectSchema.virtual('daysRemaining').get(function() {
  const now = new Date();
  const end = new Date(this.endDate);
  const diff = end - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

ProjectSchema.index({ status: 1, createdAt: -1 });
ProjectSchema.index({ createdBy: 1 });
ProjectSchema.index({ projectHeads: 1 });
ProjectSchema.index({ projectHead: 1 });
ProjectSchema.index({ department: 1 });
ProjectSchema.index({ endDate: 1, status: 1 });
ProjectSchema.index({ name: 'text', description: 'text' });

export default mongoose.models.Project || mongoose.model('Project', ProjectSchema);