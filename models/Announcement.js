import mongoose from 'mongoose';

const AnnouncementSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['general', 'urgent', 'event', 'policy', 'celebration'],
    default: 'general',
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },
  publishDate: {
    type: Date,
    default: Date.now,
  },
  expiryDate: {
    type: Date,
  },
  targetAudience: {
    type: String,
    enum: ['all', 'department', 'specific'],
    default: 'all',
  },
  departments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  }],
  specificEmployees: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  }],
  attachments: [{
    name: String,
    url: String,
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  createdByRole: {
    type: String
  },
  isDepartmentAnnouncement: {
    type: Boolean,
    default: false,
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'expired', 'archived'],
    default: 'draft',
  },
  views: [{
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    viewedAt: { type: Date, default: Date.now },
  }],
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  }],
  comments: [{
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    comment: String,
    commentedAt: { type: Date, default: Date.now },
    isAnonymous: { type: Boolean, default: false },
    likes: { type: Number, default: 0 },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }]
  }],
  // Enhanced fields
  category: {
    type: String,
    enum: ['general', 'policy', 'event', 'achievement', 'birthday', 'holiday', 'emergency', 'system', 'hr', 'finance', 'it', 'training'],
    default: 'general'
  },
  summary: {
    type: String,
    maxlength: 300
  },
  featuredImage: {
    fileName: String,
    filePath: String,
    altText: String
  },
  // Interaction features
  allowComments: { type: Boolean, default: true },
  allowReactions: { type: Boolean, default: true },
  requireAcknowledgment: { type: Boolean, default: false },
  // Engagement tracking
  engagement: {
    totalViews: { type: Number, default: 0 },
    totalLikes: { type: Number, default: 0 },
    totalComments: { type: Number, default: 0 },
    totalShares: { type: Number, default: 0 },
    acknowledgments: { type: Number, default: 0 }
  },
  // Reactions
  reactions: [{
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    reaction: {
      type: String,
      enum: ['like', 'love', 'laugh', 'wow', 'sad', 'angry']
    },
    reactedAt: { type: Date, default: Date.now }
  }],
  // Acknowledgments
  acknowledgments: [{
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    acknowledgedAt: { type: Date, default: Date.now }
  }],
  // Notification settings
  notifications: {
    sendEmail: { type: Boolean, default: false },
    sendPush: { type: Boolean, default: false },
    emailSent: { type: Boolean, default: false },
    pushSent: { type: Boolean, default: false },
    sentAt: Date
  },
  // Tags and search
  tags: [String],
  keywords: [String],
  // Moderation
  moderation: {
    flaggedCount: { type: Number, default: 0 },
    flaggedBy: [{
      employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      reason: String,
      flaggedAt: { type: Date, default: Date.now }
    }],
    isModerated: { type: Boolean, default: false },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    moderatedAt: Date
  },
  // System fields
  isSystemGenerated: { type: Boolean, default: false },
  systemSource: String,
  relatedEntity: {
    entityType: String,
    entityId: mongoose.Schema.Types.ObjectId
  }
}, {
  timestamps: true,
});

// Methods
AnnouncementSchema.methods.isVisibleTo = function (employee) {
  if (this.status !== 'published') return false
  if (this.expiryDate && new Date() > this.expiryDate) return false

  if (this.targetAudience === 'all') return true
  if (this.targetAudience === 'specific') {
    return this.specificEmployees.includes(employee._id)
  }
  if (this.targetAudience === 'department') {
    return this.departments.includes(employee.department)
  }

  return false
}

AnnouncementSchema.methods.addView = function (employeeId) {
  const existingView = this.views.find(view => view.employee.toString() === employeeId.toString())
  if (!existingView) {
    this.views.push({ employee: employeeId, viewedAt: new Date() })
    this.engagement.totalViews += 1
  }
}

AnnouncementSchema.methods.addReaction = function (employeeId, reaction) {
  this.reactions = this.reactions.filter(r => r.employee.toString() !== employeeId.toString())
  this.reactions.push({ employee: employeeId, reaction, reactedAt: new Date() })
  this.engagement.totalLikes = this.reactions.length
}

AnnouncementSchema.methods.addAcknowledgment = function (employeeId) {
  const existingAck = this.acknowledgments.find(ack => ack.employee.toString() === employeeId.toString())
  if (!existingAck) {
    this.acknowledgments.push({ employee: employeeId, acknowledgedAt: new Date() })
    this.engagement.acknowledgments += 1
  }
}

// Indexes
AnnouncementSchema.index({ status: 1, publishDate: -1 })
AnnouncementSchema.index({ category: 1, type: 1 })
AnnouncementSchema.index({ targetAudience: 1 })
AnnouncementSchema.index({ tags: 1 })

export default mongoose.models.Announcement || mongoose.model('Announcement', AnnouncementSchema);

