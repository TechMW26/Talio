import mongoose from 'mongoose'

const onboardingEmailSchema = new mongoose.Schema({
  // Employee reference
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: function employeeRequired() {
      // Legacy/manual scripts may queue onboarding notifications without an
      // employee link; keep strict requirement for all normal paths.
      return this.triggeredBy !== 'manual_script'
    },
  },
  
  // User reference (if user was created)
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  
  // Email details
  recipientEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  
  recipientName: {
    type: String,
    required: true,
  },
  
  // Employee details sent in email
  employeeCode: String,
  designation: String,
  department: String,
  dateOfJoining: Date,
  
  // Credentials sent (password is temporary)
  passwordSent: {
    type: String,
    required: true,
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ['pending', 'sent', 'failed'],
    default: 'pending',
  },
  
  // Error message if failed
  errorMessage: String,
  
  // Retry tracking
  retryCount: {
    type: Number,
    default: 0,
  },
  
  lastRetryAt: Date,
  
  // Auto-retry queue fields for rate limit handling
  autoRetryCount: {
    type: Number,
    default: 0,
  },
  
  // When this email should be processed (for queued/rate-limited emails)
  scheduledFor: {
    type: Date,
    default: null,
  },
  
  // If rate limited, when the limit expires
  rateLimitedUntil: {
    type: Date,
    default: null,
  },
  
  // Whether this email is in the queue awaiting processing
  queued: {
    type: Boolean,
    default: false,
  },
  
  // Who triggered the email
  triggeredBy: {
    type: String,
    enum: ['manual_creation', 'bulk_import', 'manual_retry', 'manual_script'],
    default: 'manual_creation',
  },
  
  // Admin who triggered retry (if applicable)
  retriedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  
  // Timestamps
  sentAt: Date,
  
}, {
  timestamps: true,
})

// Indexes for efficient queries
onboardingEmailSchema.index({ status: 1, createdAt: -1 })
onboardingEmailSchema.index({ employee: 1 })
onboardingEmailSchema.index({ recipientEmail: 1 })
onboardingEmailSchema.index({ createdAt: -1 })
// Index for queue processing
onboardingEmailSchema.index({ queued: 1, scheduledFor: 1 })
onboardingEmailSchema.index({ status: 1, queued: 1, scheduledFor: 1 })

// Virtual for full name
onboardingEmailSchema.virtual('fullName').get(function() {
  return this.recipientName
})

const OnboardingEmail = mongoose.models.OnboardingEmail || mongoose.model('OnboardingEmail', onboardingEmailSchema)

export default OnboardingEmail
