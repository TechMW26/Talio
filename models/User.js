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
      enum: ['android'],
      default: 'android'
    },
    deviceInfo: {
      model: String,
      osVersion: String,
      appVersion: String
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
  // Maya AI Assistant preferences
  mayaPreferences: {
    lastGreetingDate: { type: String }, // YYYY-MM-DD format to track daily greeting
    autoGreetingEnabled: { type: Boolean, default: true },
    voiceEnabled: { type: Boolean, default: true }
  },
  lastMayaGreeting: { type: Date }, // Track last greeting timestamp
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

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
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

