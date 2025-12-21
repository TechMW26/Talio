import mongoose from 'mongoose';

const CallAlertSchema = new mongoose.Schema({
  // Sender Information
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  senderEmployee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  senderRole: {
    type: String,
    enum: ['admin', 'hr', 'manager', 'employee', 'department_head'],
    required: true
  },
  senderName: {
    type: String,
    required: true
  },

  // Receiver Information
  receivers: [{
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
    name: {
      type: String,
      required: true
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department'
    },
    departmentName: String,
    // Delivery tracking per receiver
    deliveryStatus: {
      socketIO: {
        delivered: { type: Boolean, default: false },
        deliveredAt: { type: Date }
      },
      web: {
        received: { type: Boolean, default: false },
        receivedAt: { type: Date },
        audioPlayed: { type: Boolean, default: false },
        audioPlayedAt: { type: Date }
      },
      desktop: {
        received: { type: Boolean, default: false },
        receivedAt: { type: Date },
        audioPlayed: { type: Boolean, default: false },
        audioPlayedAt: { type: Date }
      },
      mobile: {
        received: { type: Boolean, default: false },
        receivedAt: { type: Date },
        audioPlayed: { type: Boolean, default: false },
        audioPlayedAt: { type: Date }
      }
    },
    // Acknowledgment
    acknowledged: { type: Boolean, default: false },
    acknowledgedAt: { type: Date }
  }],

  // Message Content
  messageTemplate: {
    type: String,
    required: true
  },
  // The actual processed message (with placeholders replaced)
  processedMessages: [{
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    message: String
  }],

  // Voice Generation
  voiceGeneration: {
    status: {
      type: String,
      enum: ['pending', 'generating', 'completed', 'failed', 'skipped'],
      default: 'pending'
    },
    // Store audio URLs per receiver (personalized messages)
    audioUrls: [{
      receiverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      url: String,
      generatedAt: Date
    }],
    // Or single audio URL if message is same for all
    sharedAudioUrl: String,
    errorMessage: String,
    generatedAt: Date
  },

  // Alert Configuration
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'high'
  },
  alertSound: {
    type: String,
    default: 'default' // Can be: default, urgent, gentle
  },

  // Trigger Information
  triggerPlatform: {
    type: String,
    enum: ['web', 'desktop', 'mobile'],
    required: true
  },
  triggerLocation: {
    type: String,
    default: 'dashboard'
  },

  // Status
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'completed', 'failed'],
    default: 'pending'
  },

  // Timestamps
  sentAt: Date,
  completedAt: Date

}, {
  timestamps: true
});

// Indexes for efficient querying
CallAlertSchema.index({ sender: 1, createdAt: -1 });
CallAlertSchema.index({ 'receivers.user': 1, createdAt: -1 });
CallAlertSchema.index({ status: 1, createdAt: -1 });
CallAlertSchema.index({ createdAt: -1 });

// Virtual for checking if all receivers acknowledged
CallAlertSchema.virtual('allAcknowledged').get(function() {
  return this.receivers.every(r => r.acknowledged);
});

// Method to mark receiver as having received alert
CallAlertSchema.methods.markReceiverDelivered = async function(userId, platform) {
  const receiver = this.receivers.find(r => r.user.toString() === userId.toString());
  if (receiver) {
    receiver.deliveryStatus.socketIO.delivered = true;
    receiver.deliveryStatus.socketIO.deliveredAt = new Date();
    
    if (platform && receiver.deliveryStatus[platform]) {
      receiver.deliveryStatus[platform].received = true;
      receiver.deliveryStatus[platform].receivedAt = new Date();
    }
    
    await this.save();
  }
  return this;
};

// Method to mark audio as played
CallAlertSchema.methods.markAudioPlayed = async function(userId, platform) {
  const receiver = this.receivers.find(r => r.user.toString() === userId.toString());
  if (receiver && receiver.deliveryStatus[platform]) {
    receiver.deliveryStatus[platform].audioPlayed = true;
    receiver.deliveryStatus[platform].audioPlayedAt = new Date();
    await this.save();
  }
  return this;
};

// Method to acknowledge alert
CallAlertSchema.methods.acknowledgeAlert = async function(userId) {
  const receiver = this.receivers.find(r => r.user.toString() === userId.toString());
  if (receiver) {
    receiver.acknowledged = true;
    receiver.acknowledgedAt = new Date();
    
    // Check if all acknowledged
    if (this.receivers.every(r => r.acknowledged)) {
      this.status = 'completed';
      this.completedAt = new Date();
    }
    
    await this.save();
  }
  return this;
};

// Static method to get alerts for a user
CallAlertSchema.statics.getAlertsForUser = async function(userId, options = {}) {
  const { limit = 20, skip = 0, acknowledged } = options;
  
  const query = { 'receivers.user': userId };
  
  if (typeof acknowledged === 'boolean') {
    query['receivers.acknowledged'] = acknowledged;
  }
  
  return this.find(query)
    .populate('sender', 'email role')
    .populate('senderEmployee', 'firstName lastName employeeCode')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

// Static method to get alert logs for admin
CallAlertSchema.statics.getAlertLogs = async function(options = {}) {
  const { limit = 50, skip = 0, senderId, startDate, endDate } = options;
  
  const query = {};
  
  if (senderId) {
    query.sender = senderId;
  }
  
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }
  
  return this.find(query)
    .populate('sender', 'email role')
    .populate('senderEmployee', 'firstName lastName employeeCode')
    .populate('receivers.employee', 'firstName lastName employeeCode')
    .populate('receivers.department', 'name')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

export default mongoose.models.CallAlert || mongoose.model('CallAlert', CallAlertSchema);
