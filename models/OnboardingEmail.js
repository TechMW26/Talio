import mongoose from 'mongoose'

const onboardingEmailSchema = new mongoose.Schema({
  // Employee reference
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
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
  
  // Who triggered the email
  triggeredBy: {
    type: String,
    enum: ['manual_creation', 'bulk_import', 'manual_retry'],
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

// Virtual for full name
onboardingEmailSchema.virtual('fullName').get(function() {
  return this.recipientName
})

const OnboardingEmail = mongoose.models.OnboardingEmail || mongoose.model('OnboardingEmail', onboardingEmailSchema)

export default OnboardingEmail
