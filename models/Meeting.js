import mongoose from 'mongoose'

const TranscriptSegmentSchema = new mongoose.Schema({
  speaker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  },
  speakerName: String,
  text: String,
  timestamp: Date,
  language: {
    type: String,
    enum: ['en', 'hi', 'hinglish'],
    default: 'en'
  }
})

const MOMItemSchema = new mongoose.Schema({
  topic: String,
  discussion: String,
  actionItems: [{
    description: String,
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    deadline: Date,
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed'],
      default: 'pending'
    }
  }],
  decisions: [String],
  createdAt: {
    type: Date,
    default: Date.now
  }
})

const MeetingInviteeSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'maybe'],
    default: 'pending'
  },
  rejectionReason: String,
  respondedAt: Date,
  notificationSent: {
    type: Boolean,
    default: false
  },
  emailSent: {
    type: Boolean,
    default: false
  },
  pushSent: {
    type: Boolean,
    default: false
  },
  joinedAt: Date,
  leftAt: Date,
  // For offline meetings - audio capture consent
  audioConsent: {
    type: Boolean,
    default: false
  }
})

const MeetingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    enum: ['online', 'offline'],
    required: true
  },
  // Meeting timing
  scheduledStart: {
    type: Date,
    required: true
  },
  scheduledEnd: {
    type: Date,
    required: true
  },
  actualStart: Date,
  actualEnd: Date,
  duration: {
    type: Number, // in minutes
    default: 60
  },
  // For offline meetings
  location: {
    type: String,
    trim: true
  },
  // For online meetings
  roomId: {
    type: String,
    unique: true,
    sparse: true
  },
  roomPassword: String,
  // Meeting link for external sharing
  meetingLink: String,
  // Whether the meeting link is still active (auto-deactivated after end time)
  isLinkActive: {
    type: Boolean,
    default: true
  },
  // Guest access settings
  guestAccess: {
    enabled: {
      type: Boolean,
      default: false
    },
    guestLink: String, // Unique guest link token
    guestLinkCreatedAt: Date,
    // Optional: require approval for guests
    requireApproval: {
      type: Boolean,
      default: false
    },
    // List of guests who joined
    guests: [{
      name: String,
      joinedAt: Date,
      leftAt: Date,
      socketId: String
    }]
  },
  // Organizer
  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  // Invitees with their status
  invitees: [MeetingInviteeSchema],
  // Departments invited (for quick reference)
  invitedDepartments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  }],
  // Meeting status
  status: {
    type: String,
    enum: ['scheduled', 'in-progress', 'completed', 'cancelled', 'rescheduled'],
    default: 'scheduled'
  },
  // Cancellation details
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  cancellationReason: String,
  cancelledAt: Date,
  // Recording details (for online meetings)
  recording: {
    url: String,
    duration: Number,
    size: Number,
    uploadedAt: Date
  },
  // Transcript (for both online and offline)
  transcript: [TranscriptSegmentSchema],
  transcriptLanguages: [{
    type: String,
    enum: ['en', 'hi', 'hinglish']
  }],
  // Minutes of Meeting
  mom: [MOMItemSchema],
  momGeneratedAt: Date,
  // AI Summary
  aiSummary: {
    summary: String,
    keyPoints: [String],
    actionItems: [String],
    decisions: [String],
    nextSteps: [String],
    generatedAt: Date,
    language: {
      type: String,
      enum: ['en', 'hi', 'hinglish'],
      default: 'en'
    }
  },
  // Audio data for offline meetings
  offlineAudio: {
    combinedUrl: String,
    segments: [{
      employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
      },
      url: String,
      duration: Number,
      uploadedAt: Date
    }],
    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending'
    }
  },
  // Reminder settings
  reminders: [{
    type: {
      type: String,
      enum: ['15min', '30min', '1hour', '1day'],
    },
    sent: {
      type: Boolean,
      default: false
    },
    sentAt: Date
  }],
  // Recurring meeting settings
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurrence: {
    pattern: {
      type: String,
      enum: ['daily', 'weekly', 'biweekly', 'monthly']
    },
    endDate: Date,
    parentMeeting: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Meeting'
    }
  },
  // Agenda items
  agenda: [{
    title: String,
    description: String,
    duration: Number, // in minutes
    presenter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    }
  }],
  // Attachments
  attachments: [{
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
  }],
  // Meeting notes (shared during meeting)
  notes: {
    type: String,
    default: ''
  },
  // Tags for categorization
  tags: [String],
  // Priority
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  }
}, {
  timestamps: true
})

// Indexes for performance
MeetingSchema.index({ organizer: 1, scheduledStart: -1 })
MeetingSchema.index({ 'invitees.employee': 1, scheduledStart: -1 })
MeetingSchema.index({ status: 1, scheduledStart: 1 })
// Note: roomId already has unique:true which creates an index
MeetingSchema.index({ type: 1, scheduledStart: 1 })
MeetingSchema.index({ invitedDepartments: 1 })
MeetingSchema.index({ scheduledStart: 1, scheduledEnd: 1 })
MeetingSchema.index({ 'guestAccess.guestLink': 1 }, { sparse: true })

// Virtual for checking if meeting is past
MeetingSchema.virtual('isPast').get(function() {
  return new Date() > this.scheduledEnd
})

// Virtual for checking if meeting is happening now
MeetingSchema.virtual('isNow').get(function() {
  const now = new Date()
  return now >= this.scheduledStart && now <= this.scheduledEnd
})

// Virtual for accepted invitees count
MeetingSchema.virtual('acceptedCount').get(function() {
  return this.invitees.filter(i => i.status === 'accepted').length
})

// Virtual for pending invitees count
MeetingSchema.virtual('pendingCount').get(function() {
  return this.invitees.filter(i => i.status === 'pending').length
})

// Pre-save hook to generate room ID for online meetings
MeetingSchema.pre('save', function(next) {
  if (this.type === 'online' && !this.roomId) {
    this.roomId = `talio-meet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    this.meetingLink = `/dashboard/meetings/room/${this.roomId}`
  }
  // Generate guest link token if guest access is enabled and no link exists
  if (this.guestAccess?.enabled && !this.guestAccess?.guestLink) {
    this.guestAccess.guestLink = `guest-${Date.now()}-${Math.random().toString(36).substr(2, 12)}`
    this.guestAccess.guestLinkCreatedAt = new Date()
  }
  next()
})

export default mongoose.models.Meeting || mongoose.model('Meeting', MeetingSchema)
