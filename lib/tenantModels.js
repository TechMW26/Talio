/**
 * Tenant Model Registry
 * 
 * This module provides a way to get Mongoose models bound to a specific
 * tenant's database connection. Models are cached per connection to
 * avoid re-registration.
 */

import { getTenantConnection } from './tenantDb';

// Import all model schemas (not the default exports which are bound to the default connection)
import { Schema as mongoose_Schema } from 'mongoose';

// We need to import the schemas directly, not the models
// Since models are exported as `mongoose.models.X || mongoose.model(...)`,
// we need the schemas to register them on tenant connections

// Cache: connectionName -> { modelName -> model }
const modelCache = new Map();

/**
 * User Schema (copied from models/User.js)
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 6,
    select: false,
  },
  role: {
    type: String,
    enum: ['admin', 'hr', 'manager', 'employee', 'department_head'],
    default: 'employee',
  },
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
  },
  avatar: { type: String },
  avatarFileId: { type: String },
  isActive: { type: Boolean, default: true },
  forcePasswordChange: { type: Boolean, default: true },
  profileCompletion: {
    status: {
      type: String,
      enum: ['incomplete', 'partially_complete', 'complete'],
      default: 'incomplete',
    },
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
    completedFields: {
      personalInfo: { type: Boolean, default: false },
      aadhaarUploaded: { type: Boolean, default: false },
      ocrVerified: { type: Boolean, default: false },
    },
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
  notificationPreferences: {
    chat: { type: Boolean, default: true },
    projects: { type: Boolean, default: true },
    leave: { type: Boolean, default: true },
    attendance: { type: Boolean, default: true },
    announcements: { type: Boolean, default: true }
  },
  mayaPreferences: {
    lastGreetingDate: { type: String },
    autoGreetingEnabled: { type: Boolean, default: true },
    voiceEnabled: { type: Boolean, default: true }
  },
  lastMayaGreeting: { type: Date },
  settings: {
    screenshotInterval: { type: Number, default: 5 },
    screenshotIntervalUpdatedAt: { type: Date }
  },
  isDepartmentHead: { type: Boolean, default: false },
  headOfDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }]
}, { timestamps: true });

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
UserSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

UserSchema.index({ employeeId: 1 });
UserSchema.index({ role: 1, isActive: 1 });

/**
 * Employee Schema (minimal version for login)
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
  address: {
    street: String, city: String, state: String, country: String, postalCode: String, fullAddress: String
  },
  emergencyContact: { name: String, relationship: String, phone: String },
}, { timestamps: true, strict: false });

/**
 * Department Schema (minimal for lookup)
 */
const DepartmentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: String,
  description: String,
  head: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  heads: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  isActive: { type: Boolean, default: true },
}, { timestamps: true, strict: false });

/**
 * Designation Schema (minimal for lookup)
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
 * UserSession Schema (for session tracking)
 */
const UserSessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tokenId: { type: String, required: true, unique: true },
  deviceInfo: {
    browser: String, browserVersion: String, os: String, osVersion: String,
    device: String, deviceType: String, isMobile: Boolean
  },
  userAgent: String,
  ipAddress: String,
  expiresAt: { type: Date, required: true },
  lastActivityAt: Date,
  isActive: { type: Boolean, default: true },
  revokedAt: Date,
  revokedReason: String,
}, { timestamps: true });

// Static method to parse user agent
UserSessionSchema.statics.parseUserAgent = function(userAgent) {
  // Simplified UA parsing
  const isMobile = /mobile|android|iphone|ipad/i.test(userAgent);
  const browser = userAgent.includes('Chrome') ? 'Chrome' : 
                  userAgent.includes('Firefox') ? 'Firefox' :
                  userAgent.includes('Safari') ? 'Safari' : 'Unknown';
  return { browser, isMobile, device: isMobile ? 'Mobile' : 'Desktop' };
};

/**
 * CompanySettings Schema (minimal for login)
 */
const CompanySettingsSchema = new mongoose.Schema({
  notifications: {
    emailNotifications: { type: Boolean, default: true },
    emailEvents: {
      login: { type: Boolean, default: true },
    },
  },
}, { timestamps: true, strict: false });

// Schema registry
const SCHEMAS = {
  User: UserSchema,
  Employee: EmployeeSchema,
  Department: DepartmentSchema,
  Designation: DesignationSchema,
  UserSession: UserSessionSchema,
  CompanySettings: CompanySettingsSchema,
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
  
  if (!SCHEMAS[modelName]) {
    throw new Error(`Unknown model: ${modelName}. Available: ${Object.keys(SCHEMAS).join(', ')}`);
  }
  
  // Get or create cache for this database
  if (!modelCache.has(databaseName)) {
    modelCache.set(databaseName, new Map());
  }
  
  const dbCache = modelCache.get(databaseName);
  
  // Return cached model if exists
  if (dbCache.has(modelName)) {
    return dbCache.get(modelName);
  }
  
  // Get tenant connection
  const connection = await getTenantConnection(databaseName);
  
  // Check if model already registered on connection
  let model;
  if (connection.models[modelName]) {
    model = connection.models[modelName];
  } else {
    model = connection.model(modelName, SCHEMAS[modelName]);
  }
  
  // Cache and return
  dbCache.set(modelName, model);
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
    models[name] = await getTenantModel(databaseName, name);
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

export default {
  getTenantModel,
  getTenantModels,
  clearModelCache,
};
