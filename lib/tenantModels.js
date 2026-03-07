/**
 * Tenant Model Registry
 * 
 * This module provides a way to get Mongoose models bound to a specific
 * tenant's database connection. Models are dynamically loaded from the
 * models directory and cached per connection.
 * 
 * SECURITY: This is the ONLY way to access tenant-specific data.
 * Never use default mongoose.model() for tenant data.
 */

import { getTenantConnection } from './tenantDb';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Cache: connectionName -> { modelName -> model }
const modelCache = new Map();

// Register cache-clear callback so tenantDb.js can invalidate stale models
// when a connection is recycled (avoids circular import)
globalThis.__clearTenantModelCache = (databaseName) => {
  if (databaseName) {
    modelCache.delete(databaseName);
  } else {
    modelCache.clear();
  }
};

// Pending model creation promises to prevent race conditions
// Key: `${databaseName}:${modelName}`, Value: Promise<model>
const pendingModels = new Map();

// ============================================================================
// SCHEMA DEFINITIONS
// Each schema should match its corresponding file in models/ directory
// Using strict: false allows the schema to accept additional fields
// ============================================================================

/**
 * User Schema
 */
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6, select: false },
  encryptedOnboardingPassword: { type: String, select: false }, // AES-256-GCM encrypted onboarding password (replaces plaintext)
  role: { type: String, enum: ['admin', 'hr', 'manager', 'employee', 'department_head'], default: 'employee' },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  avatar: String,
  avatarFileId: String,
  isActive: { type: Boolean, default: true },
  forcePasswordChange: { type: Boolean, default: true },
  profileCompletion: {
    status: { type: String, enum: ['incomplete', 'partially_complete', 'complete'], default: 'incomplete' },
    aadhaarFront: { url: String, fileId: String, uploadedAt: Date },
    aadhaarBack: { url: String, fileId: String, uploadedAt: Date },
    ocrVerification: {
      status: { type: String, enum: ['pending', 'verified', 'failed', 'mismatch'], default: 'pending' },
      extractedData: { name: String, dateOfBirth: String, aadhaarNumber: String, address: String },
      mismatches: [{ field: String, profileValue: String, aadhaarValue: String }],
      verifiedAt: Date,
    },
    firstLoginAt: Date,
    profileCompletionDeadline: Date,
    completedAt: Date,
    completedFields: { personalInfo: { type: Boolean, default: false }, aadhaarUploaded: { type: Boolean, default: false }, ocrVerified: { type: Boolean, default: false } },
  },
  suspensionReason: { type: String, enum: ['profile_incomplete', 'admin_action', 'policy_violation', null] },
  suspendedAt: Date,
  lastLogin: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  fcmTokens: [{
    token: { type: String, required: true },
    device: { type: String, enum: ['android', 'web', 'ios'], default: 'android' },
    platform: { type: String, enum: ['android', 'web', 'ios'], default: 'android' },
    deviceInfo: { model: String, osVersion: String, appVersion: String, browser: String, userAgent: String },
    createdAt: { type: Date, default: Date.now },
    lastUsed: { type: Date, default: Date.now }
  }],
  notificationPreferences: { chat: { type: Boolean, default: true }, projects: { type: Boolean, default: true }, leave: { type: Boolean, default: true }, attendance: { type: Boolean, default: true }, announcements: { type: Boolean, default: true } },
  miraPreferences: { lastGreetingDate: String, autoGreetingEnabled: { type: Boolean, default: true }, voiceEnabled: { type: Boolean, default: true } },
  lastMiraGreeting: Date,
  settings: { screenshotInterval: { type: Number, default: 5 }, screenshotIntervalUpdatedAt: Date },
  isDepartmentHead: { type: Boolean, default: false },
  headOfDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }]
}, { timestamps: true, strict: false });

UserSchema.pre('save', async function (next) {
  // Audit log: track isActive changes on save
  if (this.isModified('isActive')) {
    console.log(
      `[USER AUDIT] isActive changed via save() — email: ${this.email}, ` +
      `isActive: ${this.isActive}, reason: ${this.suspensionReason || 'none'}, ` +
      `at: ${new Date().toISOString()}`
    );
  }
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);

  // AUTO-EXPIRY: If user changed their password AND forcePasswordChange is now false,
  // wipe the encrypted onboarding password — it's no longer needed
  if (this.isModified('forcePasswordChange') && this.forcePasswordChange === false) {
    this.encryptedOnboardingPassword = null;
  }

  next();
});

// ============================================================================
// SAFEGUARD: Prevent mass deactivation via updateMany
// If an updateMany tries to set isActive=false for more than 5 users at once
// without a specific _id filter, log a critical warning.
// ============================================================================
UserSchema.pre('updateMany', function (next) {
  const update = this.getUpdate();
  const flatUpdate = update?.$set || update || {};
  if (flatUpdate.isActive === false) {
    const filter = this.getFilter();
    console.error(
      `[USER AUDIT][CRITICAL] updateMany setting isActive=false — ` +
      `filter: ${JSON.stringify(filter)}, at: ${new Date().toISOString()}, ` +
      `stack: ${new Error().stack}`
    );
  }
  next();
});

UserSchema.pre('updateOne', function (next) {
  const update = this.getUpdate();
  const flatUpdate = update?.$set || update || {};
  if (flatUpdate.isActive === false) {
    const filter = this.getFilter();
    console.warn(
      `[USER AUDIT] updateOne setting isActive=false — ` +
      `filter: ${JSON.stringify(filter)}, at: ${new Date().toISOString()}`
    );
  }
  next();
});

UserSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate();
  const flatUpdate = update?.$set || update || {};
  if (flatUpdate.isActive === false) {
    const filter = this.getFilter();
    console.warn(
      `[USER AUDIT] findOneAndUpdate setting isActive=false — ` +
      `filter: ${JSON.stringify(filter)}, at: ${new Date().toISOString()}`
    );
  }
  next();
});

UserSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};
UserSchema.index({ employeeId: 1 });
UserSchema.index({ role: 1, isActive: 1 });

/**
 * Employee Schema
 */
const EmployeeSchema = new mongoose.Schema({
  employeeCode: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, lowercase: true },
  phone: String,
  dateOfBirth: Date,
  gender: { type: String, enum: ['male', 'female', 'other'] },
  profilePicture: String,
  status: { type: String, enum: ['active', 'inactive', 'on-leave', 'terminated'], default: 'active' },
  dateOfJoining: Date,
  designation: { type: mongoose.Schema.Types.ObjectId, ref: 'Designation' },
  designationLevel: Number,
  designationLevelName: String,
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  reportingManager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  address: { street: String, city: String, state: String, country: String, postalCode: String, fullAddress: String },
  emergencyContact: { name: String, relationship: String, phone: String },
  bankDetails: { bankName: String, accountNumber: String, ifscCode: String, panNumber: String },
  salary: { basic: Number, allowances: Number, deductions: Number, netSalary: Number },
  reviews: [{
    type: {
      type: String,
      enum: ['review', 'remark', 'feedback', 'warning', 'appreciation'],
      required: true
    },
    content: {
      type: String,
      required: true
    },
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    category: {
      type: String,
      enum: ['performance', 'behavior', 'skills', 'general'],
      default: 'general'
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
}, { timestamps: true, strict: false });
EmployeeSchema.index({ status: 1 });
EmployeeSchema.index({ department: 1, status: 1 });

/**
 * Department Schema
 */
const DepartmentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: String,
  description: String,
  head: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  heads: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  isActive: { type: Boolean, default: true },
  parentDepartment: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
}, { timestamps: true, strict: false });

/**
 * Designation Schema
 */
const DesignationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  code: String,
  level: Number,
  levelName: String,
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, strict: false });

/**
 * Attendance Schema
 */
const AttendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  checkIn: Date,
  checkOut: Date,
  status: { type: String, enum: ['present', 'absent', 'half-day', 'in-progress', 'on-leave', 'holiday', 'weekend'], default: 'absent' },
  checkInStatus: { type: String, enum: ['on-time', 'late', 'early'], default: 'on-time' },
  checkOutStatus: { type: String, enum: ['on-time', 'late', 'early', 'auto-checkout'], default: 'on-time' },
  workHours: { type: Number, default: 0 },
  overtime: { type: Number, default: 0 },
  totalLoggedHours: { type: Number, default: 0 },
  breakMinutes: { type: Number, default: 0 },
  shrinkagePercentage: { type: Number, default: 0 },
  location: {
    checkIn: { latitude: Number, longitude: Number, address: String, accuracy: Number },
    checkOut: { latitude: Number, longitude: Number, address: String, accuracy: Number }
  },
  source: { type: String, enum: ['manual', 'geofence', 'system', 'correction', 'import', 'auto_checkout'], default: 'manual' },
  createdBySystem: { type: Boolean, default: false },
  isManualEntry: { type: Boolean, default: false },
  // Auto-checkout tracking
  autoCheckedOut: { type: Boolean, default: false },
  autoCheckoutReason: { type: String, enum: ['midnight_cutoff', 'geofence_exit', 'overtime_timeout', null], default: null },
  autoCheckoutAt: Date,
  statusReason: String,
  remarks: String,
}, { timestamps: true, strict: false });
AttendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

/**
 * Leave Schema
 */
const LeaveSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  leaveType: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  days: { type: Number, required: true },
  reason: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  approvedAt: Date,
  rejectionReason: String,
  attachments: [{ url: String, fileId: String, fileName: String }],
}, { timestamps: true, strict: false });
LeaveSchema.index({ status: 1, createdAt: -1 });
LeaveSchema.index({ employee: 1, status: 1 });

/**
 * LeaveType Schema
 */
const LeaveTypeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true },
  description: String,
  daysPerYear: { type: Number, default: 0 },
  carryForward: { type: Boolean, default: false },
  maxCarryForward: { type: Number, default: 0 },
  isPaid: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  requiresApproval: { type: Boolean, default: true },
  applicableGender: { type: String, enum: ['all', 'male', 'female'] },
  minNoticeDays: { type: Number, default: 0 },
}, { timestamps: true, strict: false });

/**
 * LeaveBalance Schema
 */
const LeaveBalanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  leaveType: { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveType', required: true },
  year: { type: Number, required: true },
  allocated: { type: Number, default: 0 },
  used: { type: Number, default: 0 },
  pending: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
  carriedForward: { type: Number, default: 0 },
}, { timestamps: true, strict: false });
LeaveBalanceSchema.index({ employee: 1, leaveType: 1, year: 1 }, { unique: true });

/**
 * Holiday Schema
 */
const HolidaySchema = new mongoose.Schema({
  name: { type: String, required: true },
  date: { type: Date, required: true },
  endDate: Date,
  type: { type: String, enum: ['public', 'optional', 'restricted', 'company'], default: 'public' },
  isActive: { type: Boolean, default: true },
  applicableDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  year: Number,
  description: String,
}, { timestamps: true, strict: false });
HolidaySchema.index({ date: 1 });
HolidaySchema.index({ date: 1, type: 1 });

/**
 * Company Schema
 */
const CompanySchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String },
  description: { type: String, default: '' },
  timezone: { type: String, default: 'Asia/Kolkata' },
  workingHours: {
    checkInTime: { type: String, default: '09:00' },
    checkOutTime: { type: String, default: '18:00' },
    lateThresholdMinutes: { type: Number, default: 15 },
    absentThresholdMinutes: { type: Number, default: 60 },
    halfDayHours: { type: Number, default: 4 },
    fullDayHours: { type: Number, default: 8 },
    workingDays: { type: [String], default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }
  },
  isActive: { type: Boolean, default: true },
  logo: String,
  logoFileId: String,
  address: {
    street: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: '' },
    zipCode: { type: String, default: '' }
  },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  website: { type: String, default: '' },
  geofence: {
    enabled: { type: Boolean, default: false },
    strictMode: { type: Boolean, default: false },
    notifyOnExit: { type: Boolean, default: true },
    requireApproval: { type: Boolean, default: true },
    useMultipleLocations: { type: Boolean, default: true }
  },
  breakTimings: {
    enabled: { type: Boolean, default: false },
    breaks: [{
      name: String,
      startTime: String,
      endTime: String,
      duration: Number,
      isPaid: { type: Boolean, default: false }
    }]
  },
  payroll: {
    paymentDay: { type: Number, default: 1 },
    paymentCycle: { type: String, enum: ['monthly', 'bi-weekly', 'weekly'], default: 'monthly' },
    currency: { type: String, default: 'INR' },
    taxSettings: {
      enableTds: { type: Boolean, default: true },
      enablePf: { type: Boolean, default: true },
      enableEsi: { type: Boolean, default: false }
    }
  },
  notifications: {
    emailNotifications: { type: Boolean, default: true },
    emailEvents: {
      login: { type: Boolean, default: true },
      attendance: { type: Boolean, default: true },
      leave: { type: Boolean, default: true }
    },
    onboardingEmailsEnabled: { type: Boolean, default: true }
  }
}, { timestamps: true, strict: false });

/**
 * CompanySettings Schema
 */
const CompanySettingsSchema = new mongoose.Schema({
  notifications: { emailNotifications: { type: Boolean, default: true }, emailEvents: { login: { type: Boolean, default: true } } },
  attendance: { autoCheckout: { type: Boolean, default: false }, autoCheckoutTime: String, graceMinutes: { type: Number, default: 15 } },
  leave: { autoApprove: { type: Boolean, default: false }, minNoticeDays: { type: Number, default: 1 } },
}, { timestamps: true, strict: false });

/**
 * UserSession Schema
 */
const UserSessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tokenId: { type: String, required: true, unique: true },
  deviceInfo: { browser: String, browserVersion: String, os: String, osVersion: String, device: String, deviceType: String, isMobile: Boolean },
  userAgent: String,
  ipAddress: String,
  expiresAt: { type: Date, required: true },
  lastActivityAt: Date,
  isActive: { type: Boolean, default: true },
  revokedAt: Date,
  revokedReason: String,
}, { timestamps: true, strict: false });
UserSessionSchema.statics.parseUserAgent = function (userAgent) {
  const isMobile = /mobile|android|iphone|ipad/i.test(userAgent);
  const browser = userAgent?.includes('Chrome') ? 'Chrome' : userAgent?.includes('Firefox') ? 'Firefox' : userAgent?.includes('Safari') ? 'Safari' : 'Unknown';
  return { browser, isMobile, device: isMobile ? 'Mobile' : 'Desktop' };
};

/**
 * GeofenceLocation Schema
 */
const GeofenceLocationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  center: { latitude: Number, longitude: Number },
  radius: { type: Number, default: 100 },
  isActive: { type: Boolean, default: true },
  allowedDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  allowedEmployees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  address: String,
}, { timestamps: true, strict: false });

/**
 * GeofenceLog Schema
 */
const GeofenceLogSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  location: { type: mongoose.Schema.Types.ObjectId, ref: 'GeofenceLocation' },
  action: { type: String, enum: ['enter', 'exit', 'check-in', 'check-out', 'approval-request'] },
  coordinates: { latitude: Number, longitude: Number },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  approvedAt: Date,
}, { timestamps: true, strict: false });

/**
 * AttendanceCorrection Schema
 */
const AttendanceCorrectionSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  attendance: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance' },
  date: { type: Date, required: true },
  requestedCheckIn: Date,
  requestedCheckOut: Date,
  currentCheckIn: Date,
  currentCheckOut: Date,
  reason: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  approvedAt: Date,
  rejectionReason: String,
}, { timestamps: true, strict: false });

/**
 * Notification Schema
 */
const NotificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  message: String,
  type: String,
  isRead: { type: Boolean, default: false },
  link: String,
  metadata: mongoose.Schema.Types.Mixed,
}, { timestamps: true, strict: false });

/**
 * Project Schema
 */
const ProjectSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 2000 },
  status: { type: String, enum: ['planned', 'ongoing', 'completed', 'pending', 'overdue', 'archived', 'completed_pending_approval', 'approved', 'rejected'], default: 'planned' },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  projectHeads: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  projectHead: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  completionPercentage: { type: Number, default: 0, min: 0, max: 100 },
  chatGroup: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  tags: [{ type: String, trim: true }],
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, strict: false });

/**
 * Task Schema
 */
const SubtaskCommentSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 500 },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  authorRole: { type: String, enum: ['assignee', 'project_head', 'admin', 'creator', 'other'], default: 'other' },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const SubtaskRejectionSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  reason: String,
  rejectedAt: { type: Date, default: Date.now }
}, { _id: false });

const SubtaskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  // Multi-assignee acceptance tracking
  pendingAcceptance: { type: Boolean, default: false },
  acceptedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  rejectedBy: [SubtaskRejectionSchema],
  estimatedDays: { type: Number, default: 0, min: 0 },
  estimatedHours: { type: Number, default: 0, min: 0, max: 23 },
  order: { type: Number, default: 0 },
  comments: [SubtaskCommentSchema],
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

/**
 * Task Attachment Schema
 * Separate schema for task attachments to ensure proper type handling
 */
const TaskAttachmentSchema = new mongoose.Schema({
  name: String,
  url: String,
  type: String,
  size: Number,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

const TaskSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  title: { type: String, required: true, trim: true },
  description: String,
  status: { type: String, enum: ['todo', 'in-progress', 'review', 'completed', 'completed-pending-approval', 'rejected', 'blocked', 'archived'], default: 'todo' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  dueDate: Date,
  startDate: Date,
  completedAt: Date,
  lastRejectedAt: Date,
  lastRejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  rejectionCount: { type: Number, default: 0 },
  lastRejectionReason: { type: String, trim: true },
  subtasks: [SubtaskSchema],
  progressPercentage: { type: Number, default: 0, min: 0, max: 100 },
  estimatedHours: Number,
  actualHours: Number,
  deletionRequest: {
    status: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    requestedAt: Date,
    reason: { type: String, trim: true },
    respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    respondedAt: Date,
    rejectionReason: { type: String, trim: true }
  },
  tags: [String],
  order: { type: Number, default: 0 },
  parentTask: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
  attachments: [TaskAttachmentSchema],
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, strict: false });

/**
 * TaskAssignee Schema
 */
const TaskAssigneeSchema = new mongoose.Schema({
  task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  assignmentStatus: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  assignedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date },
  rejectionReason: { type: String, trim: true },
  hoursLogged: { type: Number, default: 0, min: 0 },
  notes: { type: String, trim: true },
}, { timestamps: true, strict: false });

/**
 * ProjectMember Schema
 */
const ProjectMemberSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  role: { type: String, enum: ['head', 'member', 'observer', 'external'], default: 'member' },
  invitationStatus: { type: String, enum: ['invited', 'accepted', 'rejected'], default: 'invited' },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  invitedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date },
  rejectionReason: { type: String, trim: true },
  isExternal: { type: Boolean, default: false },
  sourceDepartment: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  permissions: {
    canCreateTasks: { type: Boolean, default: true },
    canAssignTasks: { type: Boolean, default: true },
    canEditProject: { type: Boolean, default: false },
    canInviteMembers: { type: Boolean, default: false }
  },
}, { timestamps: true, strict: false });

/**
 * Chat Schema (with embedded Messages)
 */
const MessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  content: String,
  fileUrl: String,
  fileId: String,
  fileName: String,
  fileType: String,
  fileSize: Number,
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  replyTo: { type: mongoose.Schema.Types.ObjectId },
  reactions: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, reaction: String, createdAt: { type: Date, default: Date.now } }],
  isRead: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, readAt: { type: Date, default: Date.now } }],
  createdAt: { type: Date, default: Date.now }
}, { strict: false });

const ChatSchema = new mongoose.Schema({
  name: String,
  isGroup: { type: Boolean, default: false },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true }],
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  groupAdmins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  messages: [MessageSchema],
  lastMessage: { type: String },
  lastMessageAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  isProjectChat: { type: Boolean, default: false },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  groupIcon: String,
  groupIconFileId: String,
  description: String,
  pinnedMessages: [{ type: mongoose.Schema.Types.ObjectId }],
}, { timestamps: true, strict: false });

/**
 * Expense Schema
 */
const ExpenseSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  expenseType: { type: String, required: true },
  amount: { type: Number, required: true },
  date: { type: Date, required: true },
  description: String,
  receipts: [{ url: String, fileId: String, fileName: String }],
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'reimbursed'], default: 'pending' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  approvedAt: Date,
  rejectionReason: String,
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
}, { timestamps: true, strict: false });
ExpenseSchema.index({ employee: 1, createdAt: -1 });

/**
 * Payroll Schema
 */
const PayrollSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  month: { type: Number, required: true },
  year: { type: Number, required: true },
  basic: { type: Number, default: 0 },
  allowances: { type: Number, default: 0 },
  deductions: { type: Number, default: 0 },
  grossSalary: { type: Number, default: 0 },
  netSalary: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'processed', 'paid'], default: 'draft' },
  paidAt: Date,
  remarks: String,
}, { timestamps: true, strict: false });
PayrollSchema.index({ employee: 1, month: 1, year: 1 }, { unique: true });

/**
 * Document Schema
 */
const DocumentSchema = new mongoose.Schema({
  fileName: { type: String },
  fileType: { type: String },
  fileUrl: { type: String },
  // Core required fields
  name: { type: String, required: true },
  type: { type: String, required: true },
  url: { type: String, required: true },
  fileId: String,
  fileSize: Number,
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  isCompanyDocument: { type: Boolean, default: false },
  category: String,
  expiryDate: Date,
  isActive: { type: Boolean, default: true },
}, { timestamps: true, strict: false });

/**
 * Asset Schema
 */
const AssetSchema = new mongoose.Schema({
  name: { type: String, required: true },
  assetCode: { type: String, required: true, unique: true },
  category: String,
  description: String,
  status: { type: String, enum: ['available', 'assigned', 'maintenance', 'retired'], default: 'available' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  assignedAt: Date,
  purchaseDate: Date,
  purchasePrice: Number,
  serialNumber: String,
  warranty: { expiryDate: Date, details: String },
  location: String,
}, { timestamps: true, strict: false });
AssetSchema.index({ assignedTo: 1 });

/**
 * Announcement Schema
 */
const AnnouncementSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  type: { type: String, enum: ['general', 'urgent', 'event', 'policy', 'celebration'], default: 'general' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  publishDate: { type: Date, default: Date.now },
  expiryDate: Date,
  targetAudience: { type: String, enum: ['all', 'department', 'specific'], default: 'all' },
  departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  targetDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  specificEmployees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  targetRoles: [String],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  createdByRole: { type: String, enum: ['admin', 'hr', 'department_head', 'manager', 'employee', 'super_admin'] },
  isDepartmentAnnouncement: { type: Boolean, default: false },
  status: { type: String, enum: ['draft', 'published', 'expired', 'archived'], default: 'draft' },
  isActive: { type: Boolean, default: true },
  attachments: [{ name: String, url: String, fileId: String, fileName: String }],
  views: [{ employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, viewedAt: { type: Date, default: Date.now } }],
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  comments: [{ employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, comment: String, commentedAt: { type: Date, default: Date.now }, isAnonymous: { type: Boolean, default: false }, likes: { type: Number, default: 0 }, likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }] }],
  category: { type: String, enum: ['general', 'policy', 'event', 'achievement', 'birthday', 'holiday', 'emergency', 'system', 'hr', 'finance', 'it', 'training'], default: 'general' },
  summary: { type: String, maxlength: 300 },
  featuredImage: { fileName: String, filePath: String, altText: String },
  allowComments: { type: Boolean, default: true },
  allowReactions: { type: Boolean, default: true },
  requireAcknowledgment: { type: Boolean, default: false },
  engagement: { totalViews: { type: Number, default: 0 }, totalLikes: { type: Number, default: 0 }, totalComments: { type: Number, default: 0 }, totalShares: { type: Number, default: 0 }, acknowledgments: { type: Number, default: 0 } },
  reactions: [{ employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, reaction: { type: String, enum: ['like', 'love', 'laugh', 'wow', 'sad', 'angry'] }, reactedAt: { type: Date, default: Date.now } }],
  acknowledgments: [{ employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, acknowledgedAt: { type: Date, default: Date.now } }],
}, { timestamps: true, strict: false });
AnnouncementSchema.index({ status: 1, publishDate: -1 });
AnnouncementSchema.index({ isActive: 1, expiryDate: 1, createdAt: -1 });

/**
 * Helpdesk/Ticket Schema
 */
const HelpdeskSchema = new mongoose.Schema({
  ticketNumber: { type: String, required: true, unique: true },
  subject: { type: String, required: true },
  description: { type: String, required: true },
  category: String,
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical', 'urgent'], default: 'medium' },
  status: { type: String, enum: ['open', 'in-progress', 'resolved', 'closed', 'reopened'], default: 'open' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  comments: [{ content: String, author: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, createdAt: { type: Date, default: Date.now }, attachments: [{ url: String, fileId: String, fileName: String }] }],
  attachments: [{ url: { type: String }, fileId: { type: String }, fileName: { type: String } }],
  resolvedAt: Date,
  closedAt: Date,
}, { timestamps: true, strict: false });
HelpdeskSchema.index({ createdBy: 1, createdAt: -1 });
HelpdeskSchema.index({ assignedTo: 1, createdAt: -1 });

/**
 * Meeting Schema
 */
const MeetingSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  type: { type: String, enum: ['online', 'offline'], default: 'online' },
  startTime: Date,
  endTime: Date,
  scheduledStart: { type: Date, required: true },
  scheduledEnd: { type: Date, required: true },
  actualStart: Date,
  actualEnd: Date,
  duration: { type: Number, default: 60 }, // in minutes
  location: String,
  isOnline: { type: Boolean, default: false },
  roomId: { type: String, sparse: true },
  roomPassword: String,
  meetingLink: String,
  isLinkActive: { type: Boolean, default: true },
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  invitees: [{
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    status: { type: String, enum: ['pending', 'accepted', 'declined', 'rejected', 'tentative', 'maybe'], default: 'pending' },
    respondedAt: Date,
    rejectionReason: String,
    notificationSent: { type: Boolean, default: false },
    emailSent: { type: Boolean, default: false },
    pushSent: { type: Boolean, default: false },
    joinedAt: Date,
    leftAt: Date,
    audioConsent: { type: Boolean, default: false }
  }],
  invitedDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  status: { type: String, enum: ['scheduled', 'ongoing', 'in-progress', 'completed', 'cancelled', 'rescheduled'], default: 'scheduled' },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
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
  transcript: [{
    speaker: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    speakerName: String,
    text: String,
    timestamp: Date,
    language: { type: String, enum: ['en', 'hi', 'hinglish'], default: 'en' }
  }],
  transcriptLanguages: [{ type: String, enum: ['en', 'hi', 'hinglish'] }],
  // Minutes of Meeting (MOM)
  mom: [{
    topic: String,
    discussion: String,
    actionItems: [{
      description: String,
      assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      deadline: Date,
      status: { type: String, enum: ['pending', 'in-progress', 'completed'], default: 'pending' }
    }],
    decisions: [String],
    createdAt: { type: Date, default: Date.now }
  }],
  momGeneratedAt: Date,
  // AI Summary
  aiSummary: {
    summary: String,
    keyPoints: [String],
    actionItems: [String],
    decisions: [String],
    nextSteps: [String],
    generatedAt: Date,
    language: { type: String, enum: ['en', 'hi', 'hinglish'], default: 'en' }
  },
  // Audio data for offline meetings
  offlineAudio: {
    combinedUrl: String,
    segments: [{
      employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      url: String,
      duration: Number,
      uploadedAt: Date
    }],
    processingStatus: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' }
  },
  // Reminder settings
  reminders: [{
    type: { type: String, enum: ['15min', '30min', '1hour', '1day'] },
    sent: { type: Boolean, default: false },
    sentAt: Date
  }],
  // Recurring meeting settings
  isRecurring: { type: Boolean, default: false },
  recurrence: {
    pattern: { type: String, enum: ['daily', 'weekly', 'biweekly', 'monthly'] },
    endDate: Date,
    parentMeeting: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting' }
  },
  // Agenda items
  agenda: [{
    title: String,
    description: String,
    duration: Number,
    presenter: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }
  }],
  // Attachments
  attachments: [{
    name: String,
    url: String,
    type: String,
    size: Number,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    uploadedAt: { type: Date, default: Date.now }
  }],
  // Meeting notes
  notes: { type: String, default: '' },
  // Tags for categorization
  tags: [String],
  // Priority
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  // Legacy fields (backward compatibility)
  audioRecording: { url: String, fileId: String, duration: Number },
  summary: String,
}, { timestamps: true, strict: false });

/**
 * Policy Schema
 */
const PolicySchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  category: String,
  version: { type: Number, default: 1 },
  effectiveDate: Date,
  expiryDate: Date,
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  attachments: [{ url: String, fileId: String, fileName: String }],
  acknowledgments: [{ employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, acknowledgedAt: Date }],
  requiresAcknowledgment: { type: Boolean, default: true },
}, { timestamps: true, strict: false });

/**
 * Performance Schema
 */
const PerformanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  reviewPeriod: { startDate: Date, endDate: Date },
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  status: { type: String, enum: ['draft', 'submitted', 'reviewed', 'acknowledged'], default: 'draft' },
  overallRating: { type: Number, min: 1, max: 5 },
  ratings: [{ category: String, rating: Number, comments: String }],
  goals: [{ title: String, status: { type: String, enum: ['pending', 'in-progress', 'achieved', 'not-achieved'] }, weight: Number }],
  strengths: String,
  improvements: String,
  employeeComments: String,
  acknowledgedAt: Date,
}, { timestamps: true, strict: false });

/**
 * PerformanceGoal Schema
 */
const PerformanceGoalSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  title: { type: String, required: true },
  description: String,
  targetDate: Date,
  status: { type: String, enum: ['pending', 'in-progress', 'achieved', 'not-achieved'], default: 'pending' },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  category: String,
  weight: { type: Number, default: 1 },
}, { timestamps: true, strict: false });

/**
 * DailyGoal Schema
 */
const DailyGoalSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  goals: [{ title: String, completed: { type: Boolean, default: false }, completedAt: Date, priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' } }],
  notes: String,
}, { timestamps: true, strict: false });
DailyGoalSchema.index({ employee: 1, date: 1 }, { unique: true });

/**
 * Job Posting Schema — enterprise-grade recruitment module
 */
const JobPostingSchema = new mongoose.Schema({
  jobTitle: { type: String, required: true, trim: true },
  jobCode: { type: String, required: true, trim: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  designation: { type: mongoose.Schema.Types.ObjectId, ref: 'Designation' },
  numberOfPositions: { type: Number, required: true, default: 1, min: 1 },
  jobDescription: { type: String, required: true },
  requirements: [{ type: String, trim: true }],
  responsibilities: [{ type: String, trim: true }],
  benefits: [{ type: String, trim: true }],
  skills: [{ type: String, trim: true }],
  educationLevel: { type: String, enum: ['any', 'high-school', 'associate', 'bachelor', 'master', 'doctorate'], default: 'any' },
  experience: { min: { type: Number, default: 0 }, max: { type: Number, default: 0 } },
  salaryRange: {
    min: { type: Number },
    max: { type: Number },
    currency: { type: String, default: 'INR', trim: true },
    isConfidential: { type: Boolean, default: false },
  },
  location: { type: String, trim: true },
  workMode: { type: String, enum: ['on-site', 'remote', 'hybrid'], default: 'on-site' },
  employmentType: { type: String, enum: ['full-time', 'part-time', 'contract', 'internship', 'freelance'], default: 'full-time' },
  status: { type: String, enum: ['draft', 'open', 'on-hold', 'closed', 'cancelled'], default: 'draft' },
  publishedAt: { type: Date },
  applicationDeadline: { type: Date },
  hiringManager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  recruiters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  hiringPipeline: [{
    stageName: { type: String, required: true },
    stageOrder: { type: Number, required: true },
    isAutoReject: { type: Boolean, default: false },
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  closedAt: { type: Date },
  closedReason: { type: String },
}, { timestamps: true, strict: false });
JobPostingSchema.index({ status: 1, department: 1 });
JobPostingSchema.index({ jobCode: 1 }, { unique: true });
JobPostingSchema.index({ applicationDeadline: 1 });
JobPostingSchema.index({ hiringManager: 1 });

/**
 * Candidate Schema — full ATS-style candidate lifecycle
 */
const CandidateSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, trim: true },
  jobPosting: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPosting', required: true },
  resume: { name: { type: String }, url: { type: String }, uploadedAt: { type: Date, default: Date.now } },
  coverLetter: { type: String },
  currentCompany: { type: String, trim: true },
  currentDesignation: { type: String, trim: true },
  totalExperience: { type: Number },
  currentSalary: { type: Number },
  expectedSalary: { type: Number },
  noticePeriod: { type: Number },
  skills: [{ type: String, trim: true }],
  education: [{ degree: String, institution: String, year: Number, grade: String }],
  source: { type: String, enum: ['website', 'referral', 'linkedin', 'naukri', 'indeed', 'glassdoor', 'career-page', 'agency', 'other'], default: 'website' },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  stage: { type: String, enum: ['applied', 'screening', 'shortlisted', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn'], default: 'applied' },
  stageHistory: [{
    stage: { type: String, required: true },
    movedAt: { type: Date, default: Date.now },
    movedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    notes: { type: String },
  }],
  rating: { type: Number, min: 0, max: 5 },
  overallScore: { type: Number, min: 0, max: 100 },
  offer: {
    offeredDate: { type: Date },
    joiningDate: { type: Date },
    salary: { type: Number },
    designation: { type: String },
    status: { type: String, enum: ['pending', 'accepted', 'rejected', 'withdrawn', 'negotiating'] },
    offerLetterUrl: { type: String },
    notes: { type: String },
  },
  rejectionReason: { type: String },
  notes: [{
    note: { type: String, required: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    addedAt: { type: Date, default: Date.now },
  }],
  tags: [{ type: String, trim: true }],
  convertedEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
}, { timestamps: true, strict: false });
CandidateSchema.index({ jobPosting: 1, stage: 1 });
CandidateSchema.index({ email: 1, jobPosting: 1 });
CandidateSchema.index({ stage: 1 });
CandidateSchema.index({ createdAt: -1 });

/**
 * Interview Schema — tracks each interview round
 */
const InterviewSchema = new mongoose.Schema({
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
  jobPosting: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPosting', required: true },
  round: { type: Number, required: true, min: 1 },
  type: { type: String, enum: ['phone', 'video', 'in-person', 'technical', 'hr', 'panel', 'assignment'], default: 'video' },
  title: { type: String, trim: true },
  scheduledDate: { type: Date, required: true },
  duration: { type: Number, default: 60 },
  location: { type: String, trim: true },
  meetingLink: { type: String, trim: true },
  interviewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  feedback: [{
    interviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    rating: { type: Number, min: 1, max: 5 },
    strengths: { type: String },
    weaknesses: { type: String },
    comments: { type: String },
    recommendation: { type: String, enum: ['strong-hire', 'hire', 'no-hire', 'strong-no-hire', 'undecided'] },
    submittedAt: { type: Date, default: Date.now },
  }],
  status: { type: String, enum: ['scheduled', 'in-progress', 'completed', 'cancelled', 'no-show', 'rescheduled'], default: 'scheduled' },
  cancelReason: { type: String },
  notes: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
}, { timestamps: true, strict: false });
InterviewSchema.index({ candidate: 1, jobPosting: 1 });
InterviewSchema.index({ scheduledDate: 1 });
InterviewSchema.index({ status: 1 });
InterviewSchema.index({ 'interviewers': 1 });

/**
 * Idea/Suggestion Schema
 */
const SuggestionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  category: String,
  status: { type: String, enum: ['pending', 'under-review', 'approved', 'rejected', 'implemented'], default: 'pending' },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  votes: [{ employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, vote: { type: Number, enum: [1, -1] }, votedAt: Date }],
  voteCount: { type: Number, default: 0 },
  comments: [{ content: String, author: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, createdAt: { type: Date, default: Date.now } }],
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  reviewNotes: String,
}, { timestamps: true, strict: false });

/**
 * Whiteboard Schema
 */
const WhiteboardObjectSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, required: true },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
  rotation: { type: Number, default: 0 },
  strokeColor: { type: String, default: '#000000' },
  fillColor: { type: String, default: 'transparent' },
  strokeWidth: { type: Number, default: 2 },
  opacity: { type: Number, default: 1 },
  points: [{ x: Number, y: Number }],
  text: String,
  fontSize: { type: Number, default: 16 },
  fontFamily: { type: String, default: 'Arial' },
  imageData: String,
  locked: { type: Boolean, default: false },
  zIndex: { type: Number, default: 0 }
}, { _id: false, strict: false });

const WhiteboardPageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  objects: [WhiteboardObjectSchema],
  thumbnail: String,
  createdAt: { type: Date, default: Date.now }
}, { _id: false, strict: false });

const AIMessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const AIGenerationSchema = new mongoose.Schema({
  id: { type: String, required: true },
  templateType: String,
  title: String,
  description: String,
  sections: mongoose.Schema.Types.Mixed,
  conclusion: String,
  userPrompt: String,
  isPlotted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false, strict: false });

const AIAnalysisSchema = new mongoose.Schema({
  summary: { type: String, default: '' },
  messages: [AIMessageSchema],
  lastAnalyzedAt: Date,
  notes: [String],
  keyPoints: [String],
  // Agent content fields
  agentContent: {
    currentGenerationId: String,
    generations: [AIGenerationSchema]
  },
  agentPreparedContent: mongoose.Schema.Types.Mixed,
  contentElementMapping: mongoose.Schema.Types.Mixed
}, { _id: false, strict: false });

const WhiteboardShareSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  permission: { type: String, enum: ['view_only', 'editor', 'owner'], default: 'view_only' },
  sharedAt: { type: Date, default: Date.now },
  sharedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: false });

const WhiteboardSchema = new mongoose.Schema({
  title: { type: String, required: true, default: 'Untitled Board' },
  description: { type: String, default: '' },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pages: { type: [WhiteboardPageSchema], default: () => [{ id: 'page-1', objects: [] }] },
  currentPageIndex: { type: Number, default: 0 },
  theme: { type: String, enum: ['white', 'black', 'chalk'], default: 'white' },
  showGrid: { type: Boolean, default: false },
  defaultZoom: { type: Number, default: 1 },
  defaultPanX: { type: Number, default: 0 },
  defaultPanY: { type: Number, default: 0 },
  sharing: [WhiteboardShareSchema],
  isPublic: { type: Boolean, default: false },
  publicLink: { type: String, sparse: true },
  thumbnail: String,
  thumbnailFileId: String,
  tags: [String],
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'WhiteboardFolder' },
  aiAnalysis: { type: AIAnalysisSchema, default: () => ({ summary: '', messages: [], notes: [], keyPoints: [] }) },
  lastModified: { type: Date, default: Date.now },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Legacy fields for backwards compatibility
  name: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  data: mongoose.Schema.Types.Mixed,
  sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
}, { timestamps: true, strict: false });

// Check if user has permission
WhiteboardSchema.methods.hasPermission = function (userId, requiredPermission = 'view_only') {
  if (!userId) return this.isPublic && requiredPermission === 'view_only';
  const userIdStr = userId.toString();
  // Owner has all permissions
  if (this.owner && this.owner.toString() === userIdStr) return true;
  // Legacy createdBy check
  if (this.createdBy && this.createdBy.toString() === userIdStr) return true;
  // Check sharing
  const share = this.sharing?.find(s => s.userId?.toString() === userIdStr);
  if (!share) return this.isPublic && requiredPermission === 'view_only';
  const permissionLevels = { 'view_only': 1, 'editor': 2, 'owner': 3 };
  return permissionLevels[share.permission] >= permissionLevels[requiredPermission];
};

// Get user's permission level
WhiteboardSchema.methods.getUserPermission = function (userId) {
  if (!userId) return this.isPublic ? 'view_only' : null;
  const userIdStr = userId.toString();
  // Owner has owner permission
  if (this.owner && this.owner.toString() === userIdStr) return 'owner';
  // Legacy createdBy check
  if (this.createdBy && this.createdBy.toString() === userIdStr) return 'owner';
  // Check sharing
  const share = this.sharing?.find(s => s.userId?.toString() === userIdStr);
  if (share) return share.permission;
  // Public boards give view_only
  if (this.isPublic) return 'view_only';
  return null;
};

// Static method to generate unique public link
WhiteboardSchema.statics.generatePublicLink = function () {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * Activity Schema - for tracking clock events, breaks, etc.
 */
const ActivitySchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  type: { type: String, enum: ['clock-in', 'clock-out', 'screenshot', 'activity', 'break-start', 'break-end'] },
  screenshot: { url: String, fileId: String, blurredUrl: String },
  activeWindow: String,
  activeApp: String,
  activityLevel: Number,
  location: { latitude: Number, longitude: Number },
}, { timestamps: true, strict: false });

/**
 * Screenshot Schema - stores screenshot metadata
 * Actual image data is in ImageKit (primary), GridFS, or filesystem
 */
const ScreenshotSchema = new mongoose.Schema({
  // User who owns this screenshot
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Employee reference for team queries
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  // GridFS file ID for the actual image (fallback)
  gridfsFileId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  },
  // ImageKit storage (primary)
  imagekitFileId: {
    type: String,
    index: true
  },
  imagekitUrl: {
    type: String
  },
  // Filesystem path for dashboard display
  path: {
    type: String,
    index: true
  },
  // Filename
  filename: {
    type: String
  },
  // Capture timestamp
  capturedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  // Date string for easy querying (YYYY-MM-DD)
  dateString: {
    type: String,
    required: true,
    index: true
  },
  // Image metadata
  metadata: {
    mimeType: { type: String, default: 'image/png' },
    width: Number,
    height: Number,
    fileSize: Number,
    format: String,
    storage: String // 'imagekit', 'gridfs', or 'filesystem'
  },
  // Activity data at time of capture
  activity: {
    activeWindow: String,
    activeApp: String,
    keystrokes: { type: Number, default: 0 },
    mouseClicks: { type: Number, default: 0 },
    mouseMovements: { type: Number, default: 0 },
    isIdle: { type: Boolean, default: false }
  },
  // Session reference (for grouping)
  sessionId: {
    type: String,
    index: true
  },
  // Flag for cleanup
  markedForDeletion: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

// Compound indexes for efficient queries
ScreenshotSchema.index({ user: 1, capturedAt: -1 });
ScreenshotSchema.index({ user: 1, dateString: 1 });
ScreenshotSchema.index({ employee: 1, dateString: 1 });

/**
 * ProductivitySession Schema
 */
const ProductivitySessionSchema = new mongoose.Schema({
  // User who owns this session
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },

  // Employee reference for team queries
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    index: true
  },

  // Date of the session (YYYY-MM-DD)
  date: {
    type: Date,
    required: true,
    index: true
  },

  // Session number for the day
  sessionNumber: {
    type: Number,
    default: 1
  },

  // AI-generated session title (short name like "Frontend Development" or "Code Review")
  sessionTitle: {
    type: String,
    default: null
  },

  // Screenshots in this session
  screenshots: [{
    url: String,
    path: String, // Support both url and path
    fileId: String,
    capturedAt: Date,
    timestamp: Date,
    filename: String,
    captureType: {
      type: String,
      enum: ['automatic', 'manual'],
      default: 'automatic'
    },
    isOfflineCapture: Boolean,
    capturedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    capturedByRole: String
  }],

  // Time range
  startTime: { type: Date, required: true },
  endTime: Date,

  // Duration tracking
  totalDuration: { type: Number, default: 0 },
  activeDuration: { type: Number, default: 0 },
  idleDuration: { type: Number, default: 0 },
  estimatedDuration: { type: Number, default: 0 },

  // Legacy field
  productivityScore: { type: Number, min: 0, max: 100 },

  // Apps used (legacy)
  apps: [{ name: String, duration: Number, category: String }],

  // AI Analysis results
  analysis: {
    isAnalyzed: { type: Boolean, default: false },
    analyzedAt: Date,
    summary: { type: String, default: '' },
    score: { type: Number, min: 0, max: 100, default: null },
    focusScore: { type: Number, min: 0, max: 100, default: null },
    taskCompletionIndicators: { type: Number, min: 0, max: 100, default: null },

    // Time distribution percentages
    timeDistribution: {
      deepWork: { type: Number, default: 0 },
      collaboration: { type: Number, default: 0 },
      administrative: { type: Number, default: 0 },
      unfocused: { type: Number, default: 0 },
      idle: { type: Number, default: 0 }
    },

    // Focus metrics
    focusMetrics: {
      longestFocusStreak: { type: String },
      contextSwitches: { type: Number, default: 0 },
      distractionCount: { type: Number, default: 0 },
      idleScreensDetected: { type: Number, default: 0 }
    },

    achievements: [{ type: String }],
    suggestions: [{ type: String }],
    insights: [{ type: String }],
    concerns: [{ type: String }],
    redFlags: [{ type: String }],

    // Work categories breakdown
    workCategories: [{
      category: String,
      percentage: Number,
      description: String,
      isActive: Boolean,
      isWorkRelated: Boolean,
      sites: [String],
      reason: String
    }],

    // Per-screenshot analysis (legacy: screenshotSummaries)
    screenshotSummaries: [{
      screenshotPath: String,
      timestamp: Date,
      summary: String,
      activity: String,
      productivity: String,
      websiteVisible: String,
      applicationVisible: String
    }],
    screenshotAnalysis: [{
      index: Number,
      timestamp: String,
      summary: String,
      activity: String,
      productivity: String,
      applicationVisible: String,
      websiteVisible: String,
      isActiveWork: Boolean,
      concerns: String,
      youtubeStatus: String
    }],

    // Applications detected
    detectedApplications: [{
      name: String,
      duration: Number,
      category: String
    }],
    applications: [{
      name: String,
      category: String,
      estimatedMinutes: Number,
      productivityImpact: String,
      wasActivelyUsed: Boolean
    }],

    // Websites visited
    websites: [{
      domain: String,
      category: String,
      estimatedMinutes: Number,
      wasActivelyViewed: Boolean
    }],

    // Task relativity analysis
    taskRelativity: {
      score: { type: Number, min: 0, max: 100, default: null },
      matchedTasks: [{ type: String }],
      unrelatedActivities: [{ type: String }],
      assessment: String
    },

    // Overall assessment
    overallAssessment: {
      genuineWorkPercentage: Number,
      taskAlignmentPercentage: Number,
      strengths: [{ type: String }],
      majorConcerns: [{ type: String }],
      areasForImprovement: [{ type: String }],
      recommendation: String
    },

    error: String
  },

  // Metadata
  screenshotCount: { type: Number, default: 0 },
  isComplete: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'paused', 'ended'], default: 'active' },

  // Cleanup tracking
  screenshotsDeleted: { type: Boolean, default: false },
  screenshotsDeletedAt: Date,
}, { timestamps: true, strict: false });

/**
 * CallAlert Schema
 */
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
    acknowledged: { type: Boolean, default: false },
    acknowledgedAt: { type: Date }
  }],

  // Message Content
  messageTemplate: {
    type: String,
    required: true
  },
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
    audioUrls: [{
      receiverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      url: String,
      generatedAt: Date
    }],
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
    default: 'default'
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
}, { timestamps: true, strict: false });

// Virtual for checking if all receivers acknowledged
CallAlertSchema.virtual('allAcknowledged').get(function () {
  return this.receivers.every(r => r.acknowledged);
});

// Instance method to mark receiver as having received alert
CallAlertSchema.methods.markReceiverDelivered = async function (userId, platform) {
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

// Instance method to mark audio as played
CallAlertSchema.methods.markAudioPlayed = async function (userId, platform) {
  const receiver = this.receivers.find(r => r.user.toString() === userId.toString());
  if (receiver && receiver.deliveryStatus[platform]) {
    receiver.deliveryStatus[platform].audioPlayed = true;
    receiver.deliveryStatus[platform].audioPlayedAt = new Date();
    await this.save();
  }
  return this;
};

// Instance method to acknowledge alert
CallAlertSchema.methods.acknowledgeAlert = async function (userId) {
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

// Add static methods
CallAlertSchema.statics.getAlertsForUser = async function (userId, options = {}) {
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

CallAlertSchema.statics.getAlertLogs = async function (options = {}) {
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

/**
 * PushSubscription Schema
 */
const PushSubscriptionSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  endpoint: { type: String, required: true },
  keys: { p256dh: String, auth: String },
  userAgent: String,
  isActive: { type: Boolean, default: true },
}, { timestamps: true, strict: false });

/**
 * PasswordResetToken Schema
 */
import crypto from 'crypto';
const PasswordResetTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  token: { type: String, required: true, unique: true },
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  usedAt: Date,
  requestedFromIp: String,
  requestedUserAgent: String,
  usedFromIp: String,
  usedUserAgent: String,
}, { timestamps: true, strict: false });
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
PasswordResetTokenSchema.index({ user: 1, createdAt: -1 });
PasswordResetTokenSchema.index({ tokenHash: 1 });

// Static method to generate a reset token
PasswordResetTokenSchema.statics.generateToken = function () {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
};

// Static method to hash a token for lookup
PasswordResetTokenSchema.statics.hashToken = function (token) {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Check if token is valid (not expired, not used)
PasswordResetTokenSchema.methods.isValid = function () {
  return !this.usedAt && this.expiresAt > new Date();
};

/**
 * ScheduledNotification Schema
 */
const ScheduledNotificationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  scheduledFor: { type: Date, required: true },
  recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  targetRoles: [String],
  targetDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  status: { type: String, enum: ['pending', 'sent', 'cancelled', 'failed'], default: 'pending' },
  sentAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  metadata: mongoose.Schema.Types.Mixed,
}, { timestamps: true, strict: false });

/**
 * RecurringNotification Schema
 */
const RecurringNotificationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  schedule: { type: String, required: true }, // Cron expression
  recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  targetRoles: [String],
  targetDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  isActive: { type: Boolean, default: true },
  lastRun: Date,
  nextRun: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  metadata: mongoose.Schema.Types.Mixed,
}, { timestamps: true, strict: false });

/**
 * ActionableNotification Schema
 * Persistent notifications requiring user action (accept/reject/view/etc.)
 * Survives across sessions until action is taken
 */
const ActionableNotificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  icon: { type: String, default: '🔔' },
  type: {
    type: String,
    enum: ['project_invitation', 'task_assignment', 'meeting_invitation', 'leave_approval', 'expense_approval', 'document_approval', 'travel_approval', 'attendance_correction', 'helpdesk_assignment', 'announcement', 'generic'],
    required: true,
    index: true
  },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  status: { type: String, enum: ['pending', 'actioned', 'dismissed', 'expired'], default: 'pending', index: true },
  actionTaken: {
    action: String,
    takenAt: Date,
    reason: String
  },
  reference: {
    model: { type: String, enum: ['Project', 'Task', 'Meeting', 'Leave', 'Expense', 'Travel', 'Document', 'Attendance', 'Helpdesk', 'Announcement'] },
    id: { type: mongoose.Schema.Types.ObjectId }
  },
  actions: [{
    id: { type: String, required: true },
    label: { type: String, required: true },
    variant: { type: String, enum: ['primary', 'secondary', 'danger', 'success', 'warning'], default: 'primary' },
    endpoint: String,
    method: { type: String, enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'POST' },
    payload: mongoose.Schema.Types.Mixed,
    requiresConfirmation: { type: Boolean, default: false },
    confirmationMessage: String,
    requiresReason: { type: Boolean, default: false },
    reasonPrompt: String
  }],
  url: String,
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  expiresAt: Date,
  displaySettings: {
    persistent: { type: Boolean, default: true },
    showInBell: { type: Boolean, default: true },
    playSound: { type: Boolean, default: true }
  }
}, { timestamps: true, strict: false });

ActionableNotificationSchema.index({ user: 1, status: 1, createdAt: -1 });
ActionableNotificationSchema.index({ 'reference.model': 1, 'reference.id': 1 });
ActionableNotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

ActionableNotificationSchema.methods.markAsActioned = async function (action, reason = null) {
  this.status = 'actioned';
  this.actionTaken = { action, takenAt: new Date(), reason };
  return await this.save();
};

ActionableNotificationSchema.methods.dismiss = async function () {
  this.status = 'dismissed';
  this.actionTaken = { action: 'dismissed', takenAt: new Date() };
  return await this.save();
};

ActionableNotificationSchema.statics.getPendingForUser = async function (userId, options = {}) {
  const query = { user: userId, status: 'pending' };
  if (options.type) query.type = options.type;
  return await this.find(query).sort({ priority: -1, createdAt: -1 }).limit(options.limit || 50).populate('createdBy', 'firstName lastName');
};

/**
 * ScreenshotAnalysis Schema
 * Stores daily AI analysis of screenshots - persists after screenshot deletion
 */
const ScreenshotAnalysisSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  dateString: { type: String, required: true },
  date: { type: Date, required: true },
  employeeContext: { name: String, designation: String, department: String, expectedWorkflow: String },
  screenshotCount: { type: Number, default: 0 },
  firstCapture: Date,
  lastCapture: Date,
  totalActiveMinutes: { type: Number, default: 0 },
  timeline: [{ startTime: Date, endTime: Date, duration: Number, activity: String, category: { type: String, enum: ['work', 'communication', 'meeting', 'break', 'idle', 'entertainment', 'research', 'other'] }, productivity: { type: String, enum: ['high', 'medium', 'low', 'idle'] }, applications: [String], description: String }],
  summary: { overview: String, keyActivities: [String], achievements: [String], concerns: [String], recommendations: [String] },
  metrics: { overallScore: { type: Number, min: 0, max: 100 }, focusScore: { type: Number, min: 0, max: 100 }, activityScore: { type: Number, min: 0, max: 100 }, consistencyScore: { type: Number, min: 0, max: 100 } },
  applicationUsage: [{ name: String, category: String, duration: Number, percentage: Number }],
  categoryBreakdown: [{ category: String, duration: Number, percentage: Number }],
  hourlyActivity: [{ hour: Number, screenshotCount: Number, avgProductivity: String, isActive: Boolean }],
  screenshotAnalyses: [{ screenshotId: mongoose.Schema.Types.ObjectId, capturedAt: Date, summary: String, detectedContent: [String], activity: String, productivity: String, application: String }],
  status: { type: String, enum: ['pending', 'analyzing', 'completed', 'failed', 'partial'], default: 'pending' },
  analyzedAt: Date,
  analysisVersion: { type: String, default: '1.0' },
  aiModel: String,
  processingTime: Number,
  error: String,
}, { timestamps: true, strict: false });
ScreenshotAnalysisSchema.index({ user: 1, dateString: 1 }, { unique: true });
ScreenshotAnalysisSchema.index({ employee: 1, date: -1 });

/**
 * ProjectCompletionApproval Schema
 */
const ProjectCompletionApprovalSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  projectHead: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  requestRemark: { type: String, maxlength: 2000 },
  responseRemark: { type: String, maxlength: 2000 },
  respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  respondedAt: Date,
  completionSnapshot: { totalTasks: { type: Number, default: 0 }, completedTasks: { type: Number, default: 0 }, completionPercentage: { type: Number, default: 0 }, pendingTasks: { type: Number, default: 0 } },
}, { timestamps: true, strict: false });
ProjectCompletionApprovalSchema.index({ project: 1, status: 1 });
ProjectCompletionApprovalSchema.index({ projectHead: 1, status: 1 });

/**
 * HealthScore Schema
 */
const HealthScoreSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  overallScore: { type: Number, min: 0, max: 100 },
  components: {
    attendance: { score: Number, weight: Number },
    productivity: { score: Number, weight: Number },
    engagement: { score: Number, weight: Number },
    performance: { score: Number, weight: Number },
  },
  trend: { type: String, enum: ['improving', 'stable', 'declining'] },
  alerts: [{ type: String, message: String, severity: { type: String, enum: ['low', 'medium', 'high'] } }],
}, { timestamps: true, strict: false });
HealthScoreSchema.index({ employee: 1, date: 1 });

/**
 * ApprovalRequest Schema (generic approvals)
 */
const ApprovalRequestSchema = new mongoose.Schema({
  type: { type: String, required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  approvers: [{ employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }, respondedAt: Date, comments: String }],
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
  data: mongoose.Schema.Types.Mixed,
  relatedModel: String,
  relatedId: mongoose.Schema.Types.ObjectId,
}, { timestamps: true, strict: false });

/**
 * ProjectApprovalRequest Schema
 */
const ProjectApprovalRequestSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  type: {
    type: String,
    required: true,
    enum: ['task_deletion', 'task_completion', 'task_review', 'project_completion', 'member_removal']
  },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  reviewedAt: { type: Date },
  reviewerComment: { type: String, trim: true },
  relatedTask: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
  relatedMember: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  reason: { type: String, trim: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, strict: false });

/**
 * ProjectNote Schema
 */
const ProjectNoteSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  title: { type: String, trim: true, maxlength: 100 },
  content: { type: String, required: true, trim: true, maxlength: 2000 },
  color: { type: String, enum: ['yellow', 'blue', 'green', 'pink', 'purple', 'orange'], default: 'yellow' },
  position: { x: { type: Number, default: 0 }, y: { type: Number, default: 0 } },
  isPinned: { type: Boolean, default: false },
  relatedTask: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
  visibility: { type: String, enum: ['team', 'personal'], default: 'team' },
  isArchived: { type: Boolean, default: false },
  attachments: [{ url: String, fileId: String, fileName: String }],
}, { timestamps: true, strict: false });

/**
 * ProjectTimelineEvent Schema
 */
const ProjectTimelineEventSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  type: {
    type: String,
    required: true,
    enum: [
      'project_created', 'project_updated', 'project_status_changed', 'project_completed',
      'member_invited', 'member_accepted', 'member_rejected', 'member_removed',
      'task_created', 'task_updated', 'task_assigned', 'task_status_changed', 'task_completed',
      'task_deleted', 'task_deletion_requested', 'task_reassigned',
      'task_assignment_accepted', 'task_assignment_rejected',
      'subtask_added', 'subtask_completed', 'subtask_reopened', 'subtask_updated', 'subtask_deleted',
      'comment_added', 'project_completion_requested', 'project_approved', 'project_rejected',
      'attachment_added', 'milestone_reached'
    ]
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  relatedTask: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
  relatedMember: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  description: { type: String, trim: true },
  commentContent: { type: String, trim: true, maxlength: 2000 }
}, { timestamps: true, strict: false });

/**
 * OvertimeRequest Schema
 */
const OvertimeRequestSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  hours: { type: Number, required: true },
  reason: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  approvedAt: Date,
}, { timestamps: true, strict: false });

/**
 * OnboardingEmail Schema
 */
const OnboardingEmailSchema = new mongoose.Schema({
  // Employee reference
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },

  // User reference (if user was created)
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Email details
  recipientEmail: { type: String, required: true, lowercase: true, trim: true },
  recipientName: { type: String, required: true },

  // Employee details sent in email
  employeeCode: String,
  designation: String,
  department: String,
  dateOfJoining: Date,

  // Credentials sent (password is temporary)
  passwordSent: { type: String, required: true },

  // Status tracking
  status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },

  // Error message if failed
  errorMessage: String,

  // Retry tracking
  retryCount: { type: Number, default: 0 },
  lastRetryAt: Date,

  // Auto-retry queue fields for rate limit handling
  autoRetryCount: { type: Number, default: 0 },
  scheduledFor: { type: Date, default: null },
  rateLimitedUntil: { type: Date, default: null },
  queued: { type: Boolean, default: false },

  // Who triggered the email
  triggeredBy: { type: String, enum: ['manual_creation', 'bulk_import', 'manual_retry'], default: 'manual_creation' },

  // Admin who triggered retry (if applicable)
  retriedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Timestamps
  sentAt: Date,
}, { timestamps: true, strict: false });

/**
 * SystemPreferences Schema
 */
const SystemPreferencesSchema = new mongoose.Schema({
  currency: { type: String, enum: ['INR', 'USD', 'EUR', 'GBP'], default: 'INR' },
  currencySymbol: { type: String, default: '₹' },
  timeFormat: { type: String, enum: ['12', '24'], default: '12' },
  timezone: { type: String, default: 'Asia/Kolkata' },
  dateFormat: { type: String, enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'], default: 'DD/MM/YYYY' },
  workingDaysPerWeek: { type: Number, min: 1, max: 7, default: 5 },
  workingHoursPerDay: { type: Number, min: 1, max: 24, default: 8 },
  weekStartsOn: { type: String, enum: ['monday', 'sunday'], default: 'monday' },
  defaultLeaveYear: { type: Number, default: () => new Date().getFullYear() },
  leaveCarryForward: { type: Boolean, default: true },
  maxCarryForwardDays: { type: Number, default: 10 },
  lateThresholdMinutes: { type: Number, default: 15 },
  halfDayThresholdHours: { type: Number, default: 4 },
  overtimeThresholdHours: { type: Number, default: 9 },
  profileCompletionGracePeriodDays: { type: Number, default: 7 },
  autoSuspendIncompleteProfiles: { type: Boolean, default: false },
  darkModeLogo: String,
  darkModeLogoFileId: String,
  lightModeLogo: String,
  lightModeLogoFileId: String,
  splashVideoUrl: String,
  splashVideoFileId: String,
  favicon: String,
  faviconFileId: String,
}, { timestamps: true, strict: false });

/**
 * EmailAccount Schema
 */
const EmailMessageEmbeddedSchema = new mongoose.Schema({
  messageId: { type: String, required: true },
  threadId: String,
  from: { name: String, email: String },
  to: [{ name: String, email: String }],
  cc: [{ name: String, email: String }],
  subject: { type: String, default: '(No Subject)' },
  snippet: String,
  body: String,
  bodyHtml: String,
  date: Date,
  isRead: { type: Boolean, default: false },
  isStarred: { type: Boolean, default: false },
  labels: [String],
  attachments: [{ filename: String, mimeType: String, size: Number, attachmentId: String }],
  folder: { type: String, enum: ['inbox', 'sent', 'drafts', 'trash', 'spam', 'starred', 'important', 'archive'], default: 'inbox' }
}, { _id: false });

const EmailAccountSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  email: { type: String, required: true, lowercase: true },
  provider: { type: String, enum: ['gmail', 'outlook', 'other'], default: 'gmail' },
  accessToken: { type: String, select: false },
  refreshToken: { type: String, select: false },
  tokenExpiry: Date,
  isConnected: { type: Boolean, default: false },
  isPrimary: { type: Boolean, default: false },
  lastSynced: Date,
  syncError: String,
  cachedEmails: [EmailMessageEmbeddedSchema],
  unreadCount: { type: Number, default: 0 },
  spamCount: { type: Number, default: 0 },
  settings: {
    syncEnabled: { type: Boolean, default: true },
    notificationsEnabled: { type: Boolean, default: true },
    signature: { type: String, default: '' },
    autoSyncInterval: { type: Number, default: 5 }
  }
}, { timestamps: true, strict: false });
EmailAccountSchema.index({ user: 1, email: 1 }, { unique: true });

/**
 * PersonalTodo Schema
 */
const PersonalTodoSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  title: { type: String, required: true, trim: true, maxlength: 500 },
  description: { type: String, trim: true, maxlength: 2000 },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'TodoCategory' },
  status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
  completedAt: Date,
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  dueDate: Date,
  dueTime: String,
  reminders: [{
    type: { type: String, enum: ['15min', '30min', '1hour', '1day', 'custom'] },
    customMinutes: Number,
    sent: { type: Boolean, default: false },
    sentAt: Date,
    emailSent: { type: Boolean, default: false },
    pushSent: { type: Boolean, default: false },
    mobileSent: { type: Boolean, default: false }
  }],
  subtasks: [{
    title: { type: String, required: true, trim: true },
    completed: { type: Boolean, default: false },
    completedAt: Date
  }],
  notes: String,
  tags: [String],
  isRecurring: { type: Boolean, default: false },
  recurrence: {
    pattern: { type: String, enum: ['daily', 'weekly', 'monthly', 'yearly'] },
    interval: { type: Number, default: 1 },
    endDate: Date,
    daysOfWeek: [Number],
    dayOfMonth: Number
  },
  analytics: {
    timeSpent: { type: Number, default: 0 },
    dueDateExtensions: { type: Number, default: 0 },
    completedOnTime: Boolean,
    daysOverdue: Number,
    completionTime: Number
  },
  order: { type: Number, default: 0 },
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date
}, { timestamps: true, strict: false });
PersonalTodoSchema.index({ user: 1, status: 1, isDeleted: 1 });
PersonalTodoSchema.index({ user: 1, category: 1, isDeleted: 1 });
PersonalTodoSchema.index({ user: 1, dueDate: 1, isDeleted: 1 });
PersonalTodoSchema.index({ employee: 1, status: 1 });
PersonalTodoSchema.index({ 'reminders.sent': 1, dueDate: 1 });

PersonalTodoSchema.pre('save', function (next) {
  if (this.isModified('status') && this.status === 'completed' && !this.completedAt) {
    this.completedAt = new Date();
    if (this.dueDate) {
      const due = new Date(this.dueDate);
      const completed = this.completedAt;
      this.analytics.completedOnTime = completed <= due;
      this.analytics.daysOverdue = Math.ceil((completed - due) / (1000 * 60 * 60 * 24));
    }
    const createdAt = this.createdAt || new Date();
    this.analytics.completionTime = Math.round((this.completedAt - createdAt) / (1000 * 60 * 60));
  }
  next();
});

/**
 * TodoCategory Schema
 */
const TodoCategorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, maxlength: 50 },
  color: { type: String, default: '#6366f1' },
  icon: { type: String, default: '📋' },
  description: { type: String, trim: true, maxlength: 200 },
  order: { type: Number, default: 0 },
  isDefault: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true, strict: false });
TodoCategorySchema.index({ user: 1, isDeleted: 1, order: 1 });

// ============================================================================
// WEBHOOK SCHEMAS
// ============================================================================

const WebhookSchema = new mongoose.Schema({
  // Who created this subscription
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Human-readable label
  name: { type: String, required: true, trim: true, maxlength: 100 },
  // Target URL that receives POST payloads
  url: { type: String, required: true, trim: true },
  // HMAC-SHA256 secret (auto-generated if not provided)
  secret: { type: String, required: true },
  // Which events this webhook subscribes to
  events: [{ type: String, required: true }],
  // Is this webhook active?
  active: { type: Boolean, default: true },
  // Optional description
  description: { type: String, trim: true, maxlength: 500 },
  // Metadata
  lastTriggeredAt: { type: Date },
  failureCount: { type: Number, default: 0 },
  // Auto-disable after N consecutive failures (default 10)
  maxFailures: { type: Number, default: 10 },
  // Custom headers to include in requests
  headers: { type: Map, of: String },
}, { timestamps: true, strict: false });
WebhookSchema.index({ createdBy: 1, active: 1 });
WebhookSchema.index({ events: 1, active: 1 });

const WebhookDeliveryLogSchema = new mongoose.Schema({
  webhook: { type: mongoose.Schema.Types.ObjectId, ref: 'Webhook', required: true },
  event: { type: String, required: true },
  // Request details
  requestUrl: { type: String },
  requestHeaders: { type: mongoose.Schema.Types.Mixed },
  requestBody: { type: mongoose.Schema.Types.Mixed },
  // Response details
  responseStatus: { type: Number },
  responseBody: { type: String, maxlength: 5000 },
  responseTimeMs: { type: Number },
  // Delivery status
  status: {
    type: String,
    enum: ['pending', 'success', 'failed', 'retrying'],
    default: 'pending'
  },
  attempt: { type: Number, default: 1 },
  maxAttempts: { type: Number, default: 5 },
  error: { type: String },
  nextRetryAt: { type: Date },
}, { timestamps: true });
WebhookDeliveryLogSchema.index({ webhook: 1, createdAt: -1 });
WebhookDeliveryLogSchema.index({ status: 1, nextRetryAt: 1 });
// Auto-delete logs older than 30 days
WebhookDeliveryLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

/**
 * PasswordAuditLog Schema
 * Tracks admin/HR access to onboarding passwords for compliance.
 */
const PasswordAuditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['view_password', 'copy_password', 'copy_credentials', 'list_passwords'],
    required: true,
  },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  performedByEmail: { type: String, required: true },
  performedByRole: { type: String, required: true },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  targetUserEmail: { type: String },
  ipAddress: { type: String },
  userAgent: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });
PasswordAuditLogSchema.index({ performedBy: 1, createdAt: -1 });
PasswordAuditLogSchema.index({ targetUser: 1, createdAt: -1 });
PasswordAuditLogSchema.index({ action: 1, createdAt: -1 });
// Auto-delete audit logs after 1 year
PasswordAuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

// ============================================================================
// SCHEMA REGISTRY
// All schemas available for tenant models
// ============================================================================

const SCHEMAS = {
  User: UserSchema,
  Employee: EmployeeSchema,
  Department: DepartmentSchema,
  Designation: DesignationSchema,
  Attendance: AttendanceSchema,
  Leave: LeaveSchema,
  LeaveType: LeaveTypeSchema,
  LeaveBalance: LeaveBalanceSchema,
  Holiday: HolidaySchema,
  Company: CompanySchema,
  CompanySettings: CompanySettingsSchema,
  UserSession: UserSessionSchema,
  GeofenceLocation: GeofenceLocationSchema,
  GeofenceLog: GeofenceLogSchema,
  AttendanceCorrection: AttendanceCorrectionSchema,
  Notification: NotificationSchema,
  Project: ProjectSchema,
  Task: TaskSchema,
  TaskAssignee: TaskAssigneeSchema,
  ProjectMember: ProjectMemberSchema,
  Chat: ChatSchema,
  Expense: ExpenseSchema,
  Payroll: PayrollSchema,
  Document: DocumentSchema,
  Asset: AssetSchema,
  Announcement: AnnouncementSchema,
  Helpdesk: HelpdeskSchema,
  Meeting: MeetingSchema,
  Policy: PolicySchema,
  Performance: PerformanceSchema,
  PerformanceGoal: PerformanceGoalSchema,
  DailyGoal: DailyGoalSchema,
  JobPosting: JobPostingSchema,
  Candidate: CandidateSchema,
  Interview: InterviewSchema,
  Suggestion: SuggestionSchema,
  Whiteboard: WhiteboardSchema,
  Activity: ActivitySchema,
  Screenshot: ScreenshotSchema,
  ProductivitySession: ProductivitySessionSchema,
  CallAlert: CallAlertSchema,
  PushSubscription: PushSubscriptionSchema,
  PasswordResetToken: PasswordResetTokenSchema,
  ScheduledNotification: ScheduledNotificationSchema,
  RecurringNotification: RecurringNotificationSchema,
  ActionableNotification: ActionableNotificationSchema,
  HealthScore: HealthScoreSchema,
  ApprovalRequest: ApprovalRequestSchema,
  ProjectApprovalRequest: ProjectApprovalRequestSchema,
  ProjectNote: ProjectNoteSchema,
  ProjectTimelineEvent: ProjectTimelineEventSchema,
  OvertimeRequest: OvertimeRequestSchema,
  OnboardingEmail: OnboardingEmailSchema,
  SystemPreferences: SystemPreferencesSchema,
  EmailAccount: EmailAccountSchema,
  ScreenshotAnalysis: ScreenshotAnalysisSchema,
  ProjectCompletionApproval: ProjectCompletionApprovalSchema,
  PersonalTodo: PersonalTodoSchema,
  TodoCategory: TodoCategorySchema,
  Webhook: WebhookSchema,
  WebhookDeliveryLog: WebhookDeliveryLogSchema,
  PasswordAuditLog: PasswordAuditLogSchema,
};

// Alias mappings for common variations
const SCHEMA_ALIASES = {
  'Ticket': 'Helpdesk',
  'Idea': 'Suggestion',
  'Recruitment': 'JobPosting',
};

// Dependency map: When loading a model, these dependent models should also be loaded
// This ensures populate() works correctly
const MODEL_DEPENDENCIES = {
  'Employee': ['Department', 'Designation', 'Company'],
  'User': ['Employee', 'Department', 'Company'],
  'Attendance': ['Employee', 'Department', 'Company'],
  'Leave': ['Employee', 'LeaveType', 'Department'],
  'LeaveBalance': ['Employee', 'LeaveType'],
  'Project': ['Employee', 'Department'],
  'Task': ['Employee', 'Project'],
  'TaskAssignee': ['Employee', 'Task'],
  'ProjectMember': ['Employee', 'Project'],
  'Chat': ['Employee', 'User'],
  'Meeting': ['Employee', 'User', 'Department'],
  'GeofenceLocation': ['Department', 'Employee'],
  'GeofenceLog': ['Employee', 'GeofenceLocation'],
  'AttendanceCorrection': ['Employee', 'Attendance'],
  'Notification': ['User', 'Employee'],
  'Expense': ['Employee', 'Department'],
  'Asset': ['Employee', 'Department'],
  'Document': ['Employee', 'Department'],
  'Helpdesk': ['Employee', 'Department'],
  'Performance': ['Employee'],
  'PerformanceGoal': ['Employee'],
  'DailyGoal': ['Employee'],
  'Announcement': ['Employee', 'Department'],
  'OvertimeRequest': ['Employee', 'Attendance'],
  'Whiteboard': ['Employee', 'User'],
  'Activity': ['Employee'],
  'ProductivitySession': ['Employee'],
  'ApprovalRequest': ['Employee'],
  'ProjectApprovalRequest': ['Employee', 'Project'],
  'ProjectNote': ['Employee', 'Project'],
  'ProjectTimelineEvent': ['Employee', 'Project'],
  'ScreenshotAnalysis': ['User', 'Employee'],
  'ProjectCompletionApproval': ['Project', 'Employee'],
  'PasswordResetToken': ['User'],
  'Webhook': ['User'],
  'WebhookDeliveryLog': ['Webhook'],
  'JobPosting': ['Employee', 'Department', 'Designation'],
  'Candidate': ['JobPosting', 'Employee'],
  'Interview': ['Candidate', 'JobPosting', 'Employee'],
};

/**
 * Get a model bound to a specific tenant connection
 * Uses a promise-based lock to prevent race conditions when multiple
 * requests try to create the same model simultaneously.
 * @param {string} databaseName - The tenant's database name
 * @param {string} modelName - The name of the model (e.g., 'User', 'Employee')
 * @returns {Promise<mongoose.Model>} - The model bound to the tenant's connection
 */
export async function getTenantModel(databaseName, modelName) {
  if (!databaseName) {
    throw new Error('Database name is required to get tenant model');
  }

  // Resolve aliases
  const resolvedName = SCHEMA_ALIASES[modelName] || modelName;

  if (!SCHEMAS[resolvedName]) {
    throw new Error(`Unknown model: ${modelName}. Available: ${Object.keys(SCHEMAS).join(', ')}`);
  }

  // Get or create cache for this database
  if (!modelCache.has(databaseName)) {
    modelCache.set(databaseName, new Map());
  }

  const dbCache = modelCache.get(databaseName);

  // Return cached model if exists AND still registered on its connection
  if (dbCache.has(resolvedName)) {
    const cachedModel = dbCache.get(resolvedName);
    // Verify the cached model's connection is still alive (readyState 1 = connected)
    // and the model is still registered on it. If the connection was recycled,
    // the cached model is stale and must be re-created.
    if (cachedModel?.db?.readyState === 1 && cachedModel.db.models[resolvedName]) {
      return cachedModel;
    }
    // Stale cache entry — remove it so it gets re-created below
    dbCache.delete(resolvedName);
  }

  // Check if there's already a pending model creation
  const pendingKey = `${databaseName}:${resolvedName}`;
  if (pendingModels.has(pendingKey)) {
    return pendingModels.get(pendingKey);
  }

  // Create a model promise and store it immediately to prevent race conditions
  const modelPromise = createModel(databaseName, resolvedName, dbCache);
  pendingModels.set(pendingKey, modelPromise);

  try {
    const model = await modelPromise;
    return model;
  } finally {
    // Clean up pending promise after resolution
    pendingModels.delete(pendingKey);
  }
}

/**
 * Internal function to create a model on a tenant connection
 * @param {string} databaseName - The tenant's database name
 * @param {string} resolvedName - The resolved model name
 * @param {Map} dbCache - The cache map for this database
 * @returns {Promise<mongoose.Model>} - The model
 */
async function createModel(databaseName, resolvedName, dbCache) {
  // Get tenant connection
  const connection = await getTenantConnection(databaseName);

  // Reuse existing model on the connection if it already exists
  // This avoids unnecessary deleteModel/model calls that trigger MongoDB 'create' commands
  let model;
  if (connection.models[resolvedName]) {
    model = connection.models[resolvedName];
  } else {
    model = connection.model(resolvedName, SCHEMAS[resolvedName]);
  }

  // Cache and return
  dbCache.set(resolvedName, model);
  return model;
}

/**
 * Get multiple models for a tenant at once
 * Dependencies are loaded lazily — only when the model isn't already cached.
 * This avoids the overhead of eagerly loading 3-5 dependency models on every API call
 * when the tenant connection already has them registered from previous requests.
 * 
 * @param {string} databaseName - The tenant's database name
 * @param {string[]} modelNames - Array of model names
 * @returns {Promise<Object>} - Object with model names as keys
 */
export async function getTenantModels(databaseName, modelNames) {
  const models = {};

  // Track alias mappings so we can return models under BOTH original and resolved names
  const aliasToOriginal = new Map(); // resolvedName -> [originalName1, originalName2, ...]

  // Collect requested models + only UNCACHED dependencies
  const allModelsToLoad = new Set();
  const dbCache = modelCache.get(databaseName);

  for (const name of modelNames) {
    const resolvedName = SCHEMA_ALIASES[name] || name;
    allModelsToLoad.add(resolvedName);

    // Track alias mapping so 'Ticket' -> 'Helpdesk' still returns models.Ticket
    if (resolvedName !== name) {
      if (!aliasToOriginal.has(resolvedName)) {
        aliasToOriginal.set(resolvedName, []);
      }
      aliasToOriginal.get(resolvedName).push(name);
    }

    // Only add dependencies that aren't already cached AND still valid
    const deps = MODEL_DEPENDENCIES[resolvedName];
    if (deps) {
      for (const dep of deps) {
        if (!dbCache || !dbCache.has(dep)) {
          allModelsToLoad.add(dep);
        } else {
          // Verify the cached dependency is still alive on its connection
          const cachedDep = dbCache.get(dep);
          if (!cachedDep?.db || cachedDep.db.readyState !== 1 || !cachedDep.db.models[dep]) {
            dbCache.delete(dep);
            allModelsToLoad.add(dep);
          }
        }
      }
    }
  }

  // Load all needed models in parallel
  const modelArray = Array.from(allModelsToLoad);
  const loadedModels = await Promise.all(
    modelArray.map(name => getTenantModel(databaseName, name))
  );

  // Map results back to model names (resolved names)
  modelArray.forEach((name, index) => {
    models[name] = loadedModels[index];
  });

  // Also map alias names so callers can use either name
  // e.g. models['Ticket'] = models['Helpdesk'] (same model instance)
  for (const [resolvedName, originalNames] of aliasToOriginal) {
    for (const originalName of originalNames) {
      models[originalName] = models[resolvedName];
    }
  }

  return models;
}

/**
 * Clear model cache for a database (useful when connection is reset)
 * @param {string} databaseName - The tenant's database name, or null to clear all
 */
export function clearModelCache(databaseName = null) {
  if (databaseName) {
    modelCache.delete(databaseName);
  } else {
    modelCache.clear();
  }
}

/**
 * Get list of all available model names
 * @returns {string[]} - Array of available model names
 */
export function getAvailableModels() {
  return Object.keys(SCHEMAS);
}

export default {
  getTenantModel,
  getTenantModels,
  clearModelCache,
  getAvailableModels,
};
