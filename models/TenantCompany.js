/**
 * TenantCompany Model
 * 
 * Represents a company (tenant) using the Talio platform.
 * Stored in the talio_superadmin database for centralized management.
 * Each tenant has their own isolated database.
 */

import mongoose from 'mongoose';
import crypto from 'crypto';
import { connectSuperadminDB } from '@/lib/superadminDb';

const TenantCompanySchema = new mongoose.Schema({
  // Basic Info
  name: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    // Used for database name: talio_company_{slug}
  },
  description: {
    type: String,
    trim: true,
  },
  logo: {
    type: String, // URL to company logo
  },
  
  // Database Configuration
  databaseName: {
    type: String,
    required: true,
    unique: true,
    // Auto-generated from slug: talio_company_{slug}
  },
  
  // Contact Information
  primaryContact: {
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    phone: { type: String },
  },
  
  // Business Details
  businessDetails: {
    gstNumber: { type: String, trim: true },
    panNumber: { type: String, trim: true },
    tanNumber: { type: String, trim: true },
    cinNumber: { type: String, trim: true }, // Company Identification Number
    businessType: {
      type: String,
      enum: ['private_limited', 'public_limited', 'llp', 'partnership', 'proprietorship', 'other'],
    },
    industry: { type: String, trim: true },
    website: { type: String, trim: true },
  },
  
  // Billing Address
  billingAddress: {
    street: String,
    city: String,
    state: String,
    country: { type: String, default: 'India' },
    postalCode: String,
  },
  
  // Registered Address (if different from billing)
  registeredAddress: {
    street: String,
    city: String,
    state: String,
    country: { type: String, default: 'India' },
    postalCode: String,
    sameAsBilling: { type: Boolean, default: true },
  },
  
  // Setup Configuration
  setupCode: {
    code: { type: String, unique: true, sparse: true },
    createdAt: Date,
    expiresAt: Date,
    isUsed: { type: Boolean, default: false },
    usedAt: Date,
    usedByEmail: String,
  },
  isSetupComplete: {
    type: Boolean,
    default: false,
  },
  setupCompletedAt: Date,
  
  // Subscription Management
  subscription: {
    plan: {
      type: String,
      enum: ['trial', 'budget', 'starter', 'professional', 'enterprise', 'custom'],
      default: 'custom',
    },
    status: {
      type: String,
      enum: ['active', 'paused', 'expired', 'cancelled', 'pending'],
      default: 'pending',
    },
    startDate: Date,
    endDate: Date,
    // Tenure in days (manual input)
    tenureDays: { type: Number, default: 30 },
    // Billing cycle
    billingCycle: {
      type: String,
      enum: ['monthly', 'quarterly', 'yearly', 'custom'],
      default: 'monthly',
    },
    // Pricing
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    // Limits (manually set)
    maxUsers: { type: Number, default: 10 },
    maxStorageGB: { type: Number, default: 1 }, // Max storage in GB
    currentUserCount: { type: Number, default: 0 },
    // Reminder tracking
    remindersSent: {
      at85Percent: { type: Boolean, default: false },
      at90Percent: { type: Boolean, default: false },
      at95Percent: { type: Boolean, default: false },
      atExpiry: { type: Boolean, default: false },
    },
    lastReminderSentAt: Date,
    // Payment tracking
    lastPaymentDate: Date,
    nextPaymentDate: Date,
  },
  
  // Feature Flags (plan-gated capabilities)
  features: {
    gpsAttendance:      { type: Boolean, default: true },
    attendanceMachines: { type: Boolean, default: false },
    geofencing:         { type: Boolean, default: false },
    leaveManagement:    { type: Boolean, default: true },
    teamChat:           { type: Boolean, default: true },
    mail:               { type: Boolean, default: true },
    meetings:           { type: Boolean, default: true },
    announcements:      { type: Boolean, default: true },
    projects:           { type: Boolean, default: false },
    productivity:       { type: Boolean, default: false },
    talioBoard:         { type: Boolean, default: false },
    employees:          { type: Boolean, default: true },
    liveUsers:          { type: Boolean, default: false },
    performance:        { type: Boolean, default: false },
    recruitment:        { type: Boolean, default: false },
    payroll:            { type: Boolean, default: false },
    expenses:           { type: Boolean, default: false },
    documents:          { type: Boolean, default: true },
    assets:             { type: Boolean, default: false },
    helpdesk:           { type: Boolean, default: false },
    policies:           { type: Boolean, default: true },
    learning:           { type: Boolean, default: false },
    ideas:              { type: Boolean, default: false },
    holidays:           { type: Boolean, default: true },
    calendar:           { type: Boolean, default: true },
    mobileApp:          { type: Boolean, default: true },
    basicReports:       { type: Boolean, default: true },
    advancedReports:    { type: Boolean, default: false },
    miraAI:             { type: Boolean, default: false },
    strategicAI:        { type: Boolean, default: false },
    customIntegrations: { type: Boolean, default: false },
    apiAccess:          { type: Boolean, default: false },
    customDomain:       { type: Boolean, default: false },
    advancedControls:   { type: Boolean, default: false },
    prioritySupport:    { type: Boolean, default: false },
    manpowerPlanning:   { type: Boolean, default: false },
    mrfWorkflow:        { type: Boolean, default: false },
    interviews:         { type: Boolean, default: false },
    offers:             { type: Boolean, default: false },
    preJoining:         { type: Boolean, default: true },
    backgroundVerification: { type: Boolean, default: false },
    onboarding:         { type: Boolean, default: true },
    departmentInduction:{ type: Boolean, default: false },
    probation:          { type: Boolean, default: false },
    internalJobPosting: { type: Boolean, default: false },
    transfers:          { type: Boolean, default: false },
    rewards:            { type: Boolean, default: false },
    engagement:         { type: Boolean, default: false },
    travel:             { type: Boolean, default: false },
    disciplinary:       { type: Boolean, default: false },
    posh:               { type: Boolean, default: false },
    exitManagement:     { type: Boolean, default: false },
    fullAndFinal:       { type: Boolean, default: false },
    experienceLetters:  { type: Boolean, default: false },
    alumni:             { type: Boolean, default: false },
  },

  // MIRA AI Token Allocation
  miraTokens: {
    perUserAllocation: { type: Number, default: 0 }, // tokens per user (e.g. 100 for Starter first month)
    allocationNote:    { type: String, default: '' }, // e.g. "First month only"
  },

  // Onboarding Payment (separate from recurring)
  onboarding: {
    amount: { type: Number, default: 0 },
    paidAt: Date,
    paymentMethod: {
      type: String,
      enum: ['bank_transfer', 'upi', 'card', 'cash', 'cheque', 'other'],
    },
    transactionId: String,
    notes: String,
    invoiceNumber: String,
  },
  
  // Payment History (for subscription payments)
  paymentHistory: [{
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    method: {
      type: String,
      enum: ['bank_transfer', 'upi', 'card', 'cash', 'cheque', 'other'],
    },
    transactionId: String,
    invoiceNumber: String,
    periodStart: Date,
    periodEnd: Date,
    notes: String,
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'completed',
    },
    createdAt: { type: Date, default: Date.now },
    createdBy: mongoose.Schema.Types.ObjectId,
  }],
  
  // Service Status
  serviceStatus: {
    type: String,
    enum: ['active', 'paused', 'suspended', 'terminated'],
    default: 'active',
  },
  servicePausedReason: String,
  servicePausedAt: Date,
  serviceResumedAt: Date,
  
  // Reminders for follow-ups
  reminders: [{
    title: { type: String, required: true },
    description: String,
    dueDate: { type: Date, required: true },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'cancelled'],
      default: 'pending',
    },
    completedAt: Date,
    createdAt: { type: Date, default: Date.now },
    createdBy: mongoose.Schema.Types.ObjectId,
  }],
  
  // Notes (for internal use)
  notes: [{
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    createdBy: mongoose.Schema.Types.ObjectId,
    category: {
      type: String,
      enum: ['general', 'billing', 'support', 'technical', 'feedback'],
      default: 'general',
    },
  }],
  
  // Development/Technical Details
  technicalDetails: {
    apiAccess: { type: Boolean, default: false },
    apiKey: String,
    webhookUrl: String,
    customDomain: String,
    sslEnabled: { type: Boolean, default: true },
    backupEnabled: { type: Boolean, default: true },
    lastBackupAt: Date,
  },
  
  // Analytics
  analytics: {
    totalLogins: { type: Number, default: 0 },
    lastActivityAt: Date,
    storageUsedMB: { type: Number, default: 0 },
    storageLastCalculatedAt: Date,
    // User limit tracking
    userLimitReachedAt: Date,
    userLimitNotificationSentAt: Date,
  },
  
  // Email History (for tracking sent emails)
  emailHistory: [{
    subject: { type: String, required: true },
    body: String,
    sentAt: { type: Date, default: Date.now },
    sentBy: mongoose.Schema.Types.ObjectId,
    sentTo: [String], // email addresses
    type: {
      type: String,
      enum: ['manual', 'reminder', 'notification', 'welcome', 'subscription', 'limit_warning'],
      default: 'manual',
    },
    status: {
      type: String,
      enum: ['sent', 'failed', 'pending'],
      default: 'sent',
    },
  }],
  
  // Status
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SuperAdmin',
  },
  
  // Tags for filtering
  tags: [{ type: String, trim: true }],
  
}, {
  timestamps: true,
});

// Generate unique setup code
TenantCompanySchema.methods.generateSetupCode = function (expiresInDays = 7) {
  const code = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);
  
  this.setupCode = {
    code,
    createdAt: now,
    expiresAt,
    isUsed: false,
  };
  
  return code;
};

// Generate database name from slug BEFORE validation
TenantCompanySchema.pre('validate', function (next) {
  if (this.slug && (!this.databaseName || this.isModified('slug'))) {
    // Sanitize slug for database name
    const sanitizedSlug = this.slug
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    
    this.databaseName = `talio_company_${sanitizedSlug}`;
  }
  next();
});

// Generate API key
TenantCompanySchema.methods.generateApiKey = function () {
  const apiKey = `tlk_${crypto.randomBytes(24).toString('hex')}`;
  this.technicalDetails.apiKey = apiKey;
  return apiKey;
};

// Index for efficient queries
// Note: slug and setupCode.code already have unique: true in schema, which auto-creates indexes
// Only add additional indexes for non-unique fields
TenantCompanySchema.index({ 'primaryContact.email': 1 });
TenantCompanySchema.index({ serviceStatus: 1, isActive: 1 });
TenantCompanySchema.index({ 'subscription.status': 1 });
TenantCompanySchema.index({ 'subscription.endDate': 1 });
TenantCompanySchema.index({ tags: 1 });

let TenantCompanyModel = null;
let lastConnection = null;

/**
 * Get the TenantCompany model connected to the superadmin database
 */
export async function getTenantCompanyModel() {
  const connection = await connectSuperadminDB();
  
  // Check if we need to refresh the model (connection changed or stale)
  if (TenantCompanyModel && lastConnection === connection && connection.readyState === 1) {
    return TenantCompanyModel;
  }
  
  // Check if model already exists on this connection
  if (connection.models.TenantCompany) {
    TenantCompanyModel = connection.models.TenantCompany;
  } else {
    TenantCompanyModel = connection.model('TenantCompany', TenantCompanySchema);
  }
  
  lastConnection = connection;
  return TenantCompanyModel;
}

export { TenantCompanySchema };
export default getTenantCompanyModel;
