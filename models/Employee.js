import mongoose from 'mongoose';

const EmployeeSchema = new mongoose.Schema({
  employeeCode: {
    type: String,
    required: true,
    unique: true,
  },
  firstName: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
    required: true,
  },
  bio: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  phone: {
    type: String,
    required: false, // Not required for bulk import flexibility
  },
  dateOfBirth: {
    type: Date,
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
  },
  maritalStatus: {
    type: String,
    enum: ['single', 'married', 'divorced', 'widowed'],
  },
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String,
  },
  emergencyContact: {
    name: String,
    relationship: String,
    phone: String,
  },
  bloodGroup: {
    type: String,
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', ''],
  },
  // Support multiple departments - employee can work in multiple departments
  departments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  }],
  // Legacy single department field for backward compatibility
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    set: v => v === '' ? null : v,
  },
  designation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Designation',
    set: v => v === '' ? null : v,
  },
  // Designation level - stored separately for quick access
  designationLevel: {
    type: Number,
    default: 1,
  },
  designationLevelName: {
    type: String,
    trim: true,
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    set: v => v === '' ? null : v,
  },
  reportingManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    set: v => v === '' ? null : v,
  },
  // Explicit hierarchy links used for cross-department visibility and assignment flows
  assignedManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    set: v => v === '' ? null : v,
  },
  assignedTeamLead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    set: v => v === '' ? null : v,
  },
  // Executive reporting chain. Required for everyone except Director (level 9).
  // Allowed targets: C-Suite (L7), Assistant Director (L8), Director (L9).
  reportsTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    set: v => v === '' ? null : v,
  },
  dateOfJoining: {
    type: Date,
    required: false, // Not required for bulk import flexibility
  },
  dateOfLeaving: {
    type: Date,
  },
  employmentType: {
    type: String,
    enum: ['full-time', 'part-time', 'contract', 'intern'],
    default: 'full-time',
  },
  workLocation: {
    type: String,
  },
  salary: {
    basic: Number,
    hra: Number,
    conveyance: Number,
    medical: Number,
    special: Number,
    allowances: Number,
    deductions: Number,
    grossSalary: Number, // Total monthly gross salary
    ctc: Number, // Annual CTC
  },
  // PF (Provident Fund) enrollment
  pfEnrollment: {
    enrolled: { type: Boolean, default: false },
    pfNumber: String,
    uanNumber: String, // Universal Account Number
    enrollmentDate: Date,
    employeeContribution: { type: Number, default: 12 }, // Percentage (default 12%)
    employerContribution: { type: Number, default: 12 }, // Percentage (default 12%)
  },
  // ESI (Employee State Insurance) enrollment
  esiEnrollment: {
    enrolled: { type: Boolean, default: false },
    esiNumber: String,
    enrollmentDate: Date,
  },
  // Professional Tax - disabled by default (0 deduction until manually enabled)
  professionalTax: {
    applicable: { type: Boolean, default: false },
    amount: { type: Number, default: 0 }, // Monthly PT amount
  },
  // TDS (Tax Deducted at Source) configuration - disabled by default
  tdsConfiguration: {
    enabled: { type: Boolean, default: false }, // TDS disabled by default - must be configured manually
    percentage: { type: Number, default: 0 }, // Custom TDS percentage for employee (0 = no TDS)
    fixedAmount: { type: Number, default: 0 }, // Fixed TDS amount (if percentage is 0)
  },
  // Corporate Health Insurance
  healthInsurance: {
    enrolled: { type: Boolean, default: false },
    policyNumber: String,
    provider: String,
    enrollmentDate: Date,
  },
  bankDetails: {
    accountNumber: String,
    bankName: String,
    ifscCode: String,
    branch: String,
  },
  documents: [{
    name: String,
    type: String,
    url: String,
    fileId: String, // ImageKit file ID for deletion
    uploadedAt: Date,
  }],
  profilePicture: {
    type: String,
  },
  // ImageKit file ID for profile picture (used for deletion/updates)
  profilePictureFileId: {
    type: String,
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'terminated', 'resigned', 'on_leave', 'probation'],
    default: 'active',
  },
  skills: [String],
  qualifications: [{
    degree: String,
    institution: String,
    year: Number,
  }],
  experience: [{
    company: String,
    position: String,
    from: Date,
    to: Date,
    description: String,
  }],
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
      ref: 'Employee',
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  aiGeneratedKRIs: [{
    title: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    importance: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium',
    },
  }],
  aiGeneratedKRIsMeta: {
    generatedAt: Date,
    generatedFromDesignation: String,
    generatedFromDepartment: String,
  },
  manualKRIs: [{
    type: String,
    trim: true,
  }],
  manualKPIs: [{
    name: {
      type: String,
      trim: true,
    },
    target: {
      type: String,
      trim: true,
    },
    unit: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
  }],
  // Productivity monitoring settings
  screenshotInterval: {
    type: Number,
    default: 30 * 60 * 1000, // 30 minutes in milliseconds
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

// Virtual for full name
EmployeeSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Indexes for performance optimization
EmployeeSchema.index({ department: 1, status: 1 }); // Common filter combination
EmployeeSchema.index({ departments: 1 }); // Multiple departments queries
EmployeeSchema.index({ status: 1, createdAt: -1 }); // List queries with sorting
EmployeeSchema.index({ reportingManager: 1 }); // Manager queries
EmployeeSchema.index({ assignedManager: 1 }); // Explicit manager assignment queries
EmployeeSchema.index({ assignedTeamLead: 1 }); // Explicit team lead assignment queries
EmployeeSchema.index({ reportsTo: 1 }); // Executive reporting chain queries
EmployeeSchema.index({ firstName: 'text', lastName: 'text', email: 'text' }); // Text search
EmployeeSchema.index({ designation: 1 }); // Designation queries

export default mongoose.models.Employee || mongoose.model('Employee', EmployeeSchema);

