import mongoose from 'mongoose';

const LeaveSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  leaveType: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LeaveType',
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  numberOfDays: {
    type: Number,
    required: true,
  },
  days: {
    type: Number,
  },
  reason: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
  },
  appliedDate: {
    type: Date,
    default: Date.now,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  },
  approvedDate: {
    type: Date,
  },
  rejectionReason: {
    type: String,
  },
  attachments: [{
    name: String,
    url: String,
  }],
  isHalfDay: {
    type: Boolean,
    default: false,
  },
  halfDaySession: {
    type: String,
    enum: ['first-half', 'second-half'],
  },
  workFromHome: {
    type: Boolean,
    default: false,
  },
  requestType: {
    type: String,
    enum: ['leave', 'half_day', 'work_from_home', 'early_leave'],
    default: 'leave',
  },
  earlyLeaveTime: String,
  // Enhanced fields
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  // Approval workflow
  approvalWorkflow: [{
    approver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true
    },
    level: {
      type: Number,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    approvedAt: Date,
    comments: String,
    isRequired: {
      type: Boolean,
      default: true
    }
  }],
  currentApprovalLevel: {
    type: Number,
    default: 1
  },
  // Additional details
  contactNumber: String,
  emergencyContact: String,
  addressDuringLeave: String,
  medicalCertificate: {
    uploaded: { type: Boolean, default: false },
    fileName: String,
    filePath: String,
    uploadedAt: Date
  },
  // Leave balance impact
  balanceImpact: {
    leaveType: String,
    daysDeducted: Number,
    balanceBefore: Number,
    balanceAfter: Number
  },
  // Handover details
  handover: {
    isRequired: { type: Boolean, default: false },
    handoverTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    handoverNotes: String,
    handoverCompleted: { type: Boolean, default: false },
    handoverCompletedAt: Date
  },
  // System fields
  applicationNumber: {
    type: String,
    unique: true
  },
  isUrgent: {
    type: Boolean,
    default: false
  },
  autoApproved: {
    type: Boolean,
    default: false
  },
  systemNotes: String,
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  rejectedAt: Date
}, {
  timestamps: true,
});

// Generate application number
LeaveSchema.pre('save', function (next) {
  const numberOfDays = Number(this.numberOfDays ?? this.days)
  if (Number.isFinite(numberOfDays)) {
    this.numberOfDays = numberOfDays
    this.days = numberOfDays
  }
  if (!this.applicationNumber) {
    const year = new Date().getFullYear()
    const month = String(new Date().getMonth() + 1).padStart(2, '0')
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
    this.applicationNumber = `LV${year}${month}${random}`
  }
  next()
})

// Methods
LeaveSchema.methods.canCancel = function () {
  return this.status === 'pending' || (this.status === 'approved' && new Date() < this.startDate)
}

LeaveSchema.methods.canEdit = function () {
  return this.status === 'pending'
}

LeaveSchema.methods.getNextApprover = function () {
  const nextLevel = this.approvalWorkflow.find(level =>
    level.level === this.currentApprovalLevel && level.status === 'pending'
  )
  return nextLevel ? nextLevel.approver : null
}

// Indexes
LeaveSchema.index({ employee: 1, startDate: 1 })
LeaveSchema.index({ status: 1 })
// applicationNumber already indexed via unique: true
LeaveSchema.index({ 'approvalWorkflow.approver': 1, 'approvalWorkflow.status': 1 })

export default mongoose.models.Leave || mongoose.model('Leave', LeaveSchema);

