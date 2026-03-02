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
  // User avatar/profile picture
  avatar: {
    type: String,
  },
  avatarFileId: {
    type: String, // ImageKit file ID for deletion
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  // Force password change on first login
  forcePasswordChange: {
    type: Boolean,
    default: true, // New users must change their password on first login
  },
  // Profile completion tracking
  profileCompletion: {
    status: {
      type: String,
      enum: ['incomplete', 'partially_complete', 'complete'],
      default: 'incomplete',
    },
    // Aadhaar document uploads
    aadhaarFront: {
      url: String,
      fileId: String, // ImageKit file ID for deletion
      uploadedAt: Date,
    },
    aadhaarBack: {
      url: String,
      fileId: String, // ImageKit file ID for deletion
      uploadedAt: Date,
    },
    // OCR verification
    ocrVerification: {
      status: {
        type: String,
        enum: ['pending', 'verified', 'failed', 'mismatch'],
        default: 'pending',
      },
      extractedData: {
        name: String,
        dateOfBirth: String,
        aadhaarNumber: String, // Last 4 digits only for security
        address: String,
      },
      mismatches: [{
        field: String,
        profileValue: String,
        aadhaarValue: String,
      }],
      verifiedAt: Date,
    },
    // Timestamps
    firstLoginAt: Date,
    profileCompletionDeadline: Date,
    completedAt: Date,
    // Track what was completed
    completedFields: {
      personalInfo: { type: Boolean, default: false },
      aadhaarUploaded: { type: Boolean, default: false },
      ocrVerified: { type: Boolean, default: false },
    },
  },
  // Account suspension for non-compliance
  suspensionReason: {
    type: String,
    enum: ['profile_incomplete', 'admin_action', 'policy_violation', null],
  },
  suspendedAt: Date,
  lastLogin: {
    type: Date,
  },
  passwordResetToken: String,
  passwordResetExpires: Date,
  // Firebase Cloud Messaging tokens for push notifications
  fcmTokens: [{
    token: {
      type: String,
      required: true
    },
    device: {
      type: String,
      enum: ['android', 'web', 'ios'],
      default: 'android'
    },
    platform: {
      type: String,
      enum: ['android', 'web', 'ios', 'android_expo', 'ios_expo', 'android_webview'],
      default: 'android'
    },
    deviceInfo: {
      model: String,
      osVersion: String,
      appVersion: String,
      browser: String,
      userAgent: String
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    lastUsed: {
      type: Date,
      default: Date.now
    }
  }],
  // Notification preferences
  notificationPreferences: {
    chat: { type: Boolean, default: true },
    projects: { type: Boolean, default: true },
    leave: { type: Boolean, default: true },
    attendance: { type: Boolean, default: true },
    announcements: { type: Boolean, default: true }
  },
  // MIRA AI Assistant preferences
  miraPreferences: {
    lastGreetingDate: { type: String }, // YYYY-MM-DD format to track daily greeting
    autoGreetingEnabled: { type: Boolean, default: true },
    voiceEnabled: { type: Boolean, default: true }
  },
  lastMiraGreeting: { type: Date }, // Track last greeting timestamp
  // General settings
  settings: {
    screenshotInterval: { type: Number, default: 5 }, // minutes
    screenshotIntervalUpdatedAt: { type: Date }
  },
  // Department Head meta - synced from Department model when user is assigned as head
  isDepartmentHead: {
    type: Boolean,
    default: false
  },
  // Array of department IDs this user is head of
  headOfDepartments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  }]
}, {
  timestamps: true,
});

// Hash password before saving + audit isActive changes
UserSchema.pre('save', async function (next) {
  // Audit log: track isActive changes on save
  if (this.isModified('isActive')) {
    console.log(
      `[USER AUDIT] isActive changed via save() — email: ${this.email}, ` +
      `isActive: ${this.isActive}, reason: ${this.suspensionReason || 'none'}, ` +
      `at: ${new Date().toISOString()}`
    );
  }
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Audit hooks: log all isActive deactivation attempts
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

// Compare password method
UserSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Indexes for performance optimization
UserSchema.index({ employeeId: 1 }); // Reverse lookup from employee
UserSchema.index({ role: 1, isActive: 1 }); // Role-based queries

export default mongoose.models.User || mongoose.model('User', UserSchema);

