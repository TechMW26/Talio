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
  mayaPreferences: { lastGreetingDate: String, autoGreetingEnabled: { type: Boolean, default: true }, voiceEnabled: { type: Boolean, default: true } },
  lastMayaGreeting: Date,
  settings: { screenshotInterval: { type: Number, default: 5 }, screenshotIntervalUpdatedAt: Date },
  isDepartmentHead: { type: Boolean, default: false },
  headOfDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }]
}, { timestamps: true, strict: false });

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
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
  reportingManager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  address: { street: String, city: String, state: String, country: String, postalCode: String, fullAddress: String },
  emergencyContact: { name: String, relationship: String, phone: String },
  bankDetails: { bankName: String, accountNumber: String, ifscCode: String, panNumber: String },
  salary: { basic: Number, allowances: Number, deductions: Number, netSalary: Number },
}, { timestamps: true, strict: false });

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
  checkOutStatus: { type: String, enum: ['on-time', 'late', 'early'], default: 'on-time' },
  workHours: { type: Number, default: 0 },
  overtime: { type: Number, default: 0 },
  totalLoggedHours: { type: Number, default: 0 },
  breakMinutes: { type: Number, default: 0 },
  shrinkagePercentage: { type: Number, default: 0 },
  location: {
    checkIn: { latitude: Number, longitude: Number, address: String, accuracy: Number },
    checkOut: { latitude: Number, longitude: Number, address: String, accuracy: Number }
  },
  source: { type: String, enum: ['manual', 'geofence', 'system', 'correction', 'import'], default: 'manual' },
  createdBySystem: { type: Boolean, default: false },
  isManualEntry: { type: Boolean, default: false },
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
  type: { type: String, enum: ['public', 'company', 'optional'], default: 'public' },
  isActive: { type: Boolean, default: true },
  applicableDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  year: Number,
  description: String,
}, { timestamps: true, strict: false });

/**
 * Company Schema
 */
const CompanySchema = new mongoose.Schema({
  name: { type: String, required: true },
  timezone: { type: String, default: 'Asia/Kolkata' },
  workingHours: { startTime: String, endTime: String, workingDays: [String] },
  isActive: { type: Boolean, default: true },
  logo: String,
  address: String,
  phone: String,
  email: String,
  website: String,
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
UserSessionSchema.statics.parseUserAgent = function(userAgent) {
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
  name: { type: String, required: true, trim: true },
  description: String,
  status: { type: String, enum: ['planned', 'ongoing', 'completed', 'pending', 'overdue', 'archived', 'completed_pending_approval', 'approved', 'rejected'], default: 'planned' },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  projectHeads: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  projectHead: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  completionPercentage: { type: Number, default: 0, min: 0, max: 100 },
  chatGroup: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  tags: [String],
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
}, { timestamps: true, strict: false });

/**
 * Task Schema
 */
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
  rejectionReason: String,
  estimatedHours: Number,
  actualHours: Number,
  tags: [String],
  attachments: [{ url: String, fileId: String, fileName: String, fileType: String, fileSize: Number, uploadedAt: Date }],
  subtasks: [{ title: String, completed: Boolean, completedAt: Date }],
}, { timestamps: true, strict: false });

/**
 * TaskAssignee Schema
 */
const TaskAssigneeSchema = new mongoose.Schema({
  task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  assignedAt: { type: Date, default: Date.now },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  status: { type: String, enum: ['active', 'removed'], default: 'active' },
}, { timestamps: true, strict: false });

/**
 * ProjectMember Schema
 */
const ProjectMemberSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  role: { type: String, enum: ['member', 'lead', 'viewer'], default: 'member' },
  addedAt: { type: Date, default: Date.now },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  isActive: { type: Boolean, default: true },
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
  lastMessage: { content: String, sender: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, createdAt: Date },
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
  name: { type: String, required: true },
  type: { type: String, required: true },
  url: { type: String, required: true },
  fileId: String,
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

/**
 * Announcement Schema
 */
const AnnouncementSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  targetDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  targetRoles: [String],
  isActive: { type: Boolean, default: true },
  publishAt: Date,
  expiresAt: Date,
  attachments: [{ url: String, fileId: String, fileName: String }],
  acknowledgments: [{ employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, acknowledgedAt: Date }],
}, { timestamps: true, strict: false });

/**
 * Helpdesk/Ticket Schema
 */
const HelpdeskSchema = new mongoose.Schema({
  ticketNumber: { type: String, required: true, unique: true },
  subject: { type: String, required: true },
  description: { type: String, required: true },
  category: String,
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  status: { type: String, enum: ['open', 'in-progress', 'resolved', 'closed', 'reopened'], default: 'open' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  comments: [{ content: String, author: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, createdAt: { type: Date, default: Date.now }, attachments: [{ url: String, fileId: String, fileName: String }] }],
  attachments: [{ url: String, fileId: String, fileName: String }],
  resolvedAt: Date,
  closedAt: Date,
}, { timestamps: true, strict: false });

/**
 * Meeting Schema
 */
const MeetingSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  location: String,
  isOnline: { type: Boolean, default: false },
  meetingLink: String,
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  invitees: [{ employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }, status: { type: String, enum: ['pending', 'accepted', 'declined', 'tentative'], default: 'pending' }, respondedAt: Date }],
  status: { type: String, enum: ['scheduled', 'ongoing', 'completed', 'cancelled'], default: 'scheduled' },
  recurrence: { type: String, enum: ['none', 'daily', 'weekly', 'monthly'], default: 'none' },
  reminders: [{ time: Date, sent: { type: Boolean, default: false } }],
  notes: String,
  attachments: [{ url: String, fileId: String, fileName: String }],
  audioRecording: { url: String, fileId: String, duration: Number },
  transcript: String,
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
 * Recruitment/Candidate Schema
 */
const RecruitmentSchema = new mongoose.Schema({
  position: { type: String, required: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  status: { type: String, enum: ['open', 'closed', 'on-hold'], default: 'open' },
  description: String,
  requirements: [String],
  salaryRange: { min: Number, max: Number },
  openings: { type: Number, default: 1 },
  candidates: [{ name: String, email: String, phone: String, resumeUrl: String, status: { type: String, enum: ['applied', 'screening', 'interview', 'offered', 'hired', 'rejected'], default: 'applied' }, notes: String, appliedAt: { type: Date, default: Date.now } }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
}, { timestamps: true, strict: false });

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
const WhiteboardSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  data: mongoose.Schema.Types.Mixed, // Excalidraw JSON
  thumbnail: String,
  sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  isPublic: { type: Boolean, default: false },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
}, { timestamps: true, strict: false });

/**
 * Activity/Screenshot Schema
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
 * ProductivitySession Schema
 */
const ProductivitySessionSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  startTime: { type: Date, required: true },
  endTime: Date,
  totalDuration: { type: Number, default: 0 },
  activeDuration: { type: Number, default: 0 },
  idleDuration: { type: Number, default: 0 },
  productivityScore: { type: Number, min: 0, max: 100 },
  screenshots: [{ url: String, fileId: String, capturedAt: Date }],
  apps: [{ name: String, duration: Number, category: String }],
  status: { type: String, enum: ['active', 'paused', 'ended'], default: 'active' },
}, { timestamps: true, strict: false });

/**
 * CallAlert Schema
 */
const CallAlertSchema = new mongoose.Schema({
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  reason: String,
  status: { type: String, enum: ['active', 'acknowledged', 'expired'], default: 'active' },
  acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  acknowledgedAt: Date,
  expiresAt: Date,
}, { timestamps: true, strict: false });

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
  requestType: { type: String, enum: ['task-completion', 'project-completion', 'delete-task', 'reassign-task'], required: true },
  task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  approver: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  comments: String,
  respondedAt: Date,
  metadata: mongoose.Schema.Types.Mixed,
}, { timestamps: true, strict: false });

/**
 * ProjectNote Schema
 */
const ProjectNoteSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  content: { type: String, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  isPinned: { type: Boolean, default: false },
  attachments: [{ url: String, fileId: String, fileName: String }],
}, { timestamps: true, strict: false });

/**
 * ProjectTimelineEvent Schema
 */
const ProjectTimelineEventSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  eventType: { type: String, required: true },
  description: String,
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  metadata: mongoose.Schema.Types.Mixed,
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
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  email: { type: String, required: true },
  status: { type: String, enum: ['pending', 'sent', 'failed', 'bounced'], default: 'pending' },
  sentAt: Date,
  error: String,
  retryCount: { type: Number, default: 0 },
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
  Recruitment: RecruitmentSchema,
  Suggestion: SuggestionSchema,
  Whiteboard: WhiteboardSchema,
  Activity: ActivitySchema,
  ProductivitySession: ProductivitySessionSchema,
  CallAlert: CallAlertSchema,
  PushSubscription: PushSubscriptionSchema,
  ScheduledNotification: ScheduledNotificationSchema,
  RecurringNotification: RecurringNotificationSchema,
  HealthScore: HealthScoreSchema,
  ApprovalRequest: ApprovalRequestSchema,
  ProjectApprovalRequest: ProjectApprovalRequestSchema,
  ProjectNote: ProjectNoteSchema,
  ProjectTimelineEvent: ProjectTimelineEventSchema,
  OvertimeRequest: OvertimeRequestSchema,
  OnboardingEmail: OnboardingEmailSchema,
  SystemPreferences: SystemPreferencesSchema,
  EmailAccount: EmailAccountSchema,
};

// Alias mappings for common variations
const SCHEMA_ALIASES = {
  'Ticket': 'Helpdesk',
  'Idea': 'Suggestion',
  'Screenshot': 'Activity',
};

/**
 * Get a model bound to a specific tenant connection
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
  
  // Return cached model if exists
  if (dbCache.has(resolvedName)) {
    return dbCache.get(resolvedName);
  }
  
  // Get tenant connection
  const connection = await getTenantConnection(databaseName);
  
  // Check if model already registered on connection
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
 * @param {string} databaseName - The tenant's database name
 * @param {string[]} modelNames - Array of model names
 * @returns {Promise<Object>} - Object with model names as keys
 */
export async function getTenantModels(databaseName, modelNames) {
  const models = {};
  
  for (const name of modelNames) {
    const resolvedName = SCHEMA_ALIASES[name] || name;
    models[resolvedName] = await getTenantModel(databaseName, name);
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
