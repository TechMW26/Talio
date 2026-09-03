import mongoose from 'mongoose';

const CompanySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true,
    unique: true
  },
  code: {
    type: String,
    required: [true, 'Company code is required'],
    trim: true,
    unique: true,
    uppercase: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  timezone: {
    type: String,
    default: 'Asia/Kolkata',
    required: true
  },
  logo: {
    type: String,
    default: ''
  },
  logoFileId: {
    type: String, // ImageKit file ID for deletion
    default: ''
  },
  // Contact Information
  email: {
    type: String,
    trim: true,
    default: ''
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  website: {
    type: String,
    trim: true,
    default: ''
  },
  // Address
  address: {
    street: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: '' },
    zipCode: { type: String, default: '' }
  },
  // Working Hours Settings
  workingHours: {
    checkInTime: { type: String, default: '09:00' }, // 24-hour format HH:mm
    checkOutTime: { type: String, default: '18:00' },
    lateThresholdMinutes: { type: Number, default: 15 },
    absentThresholdMinutes: { type: Number, default: 60 },
    halfDayHours: { type: Number, default: 4 },
    fullDayHours: { type: Number, default: 8 },
    workingDays: {
      type: [String],
      default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    }
  },
  // Geofencing Settings
  geofence: {
    enabled: { type: Boolean, default: false },
    strictMode: { type: Boolean, default: false },
    notifyOnExit: { type: Boolean, default: true },
    requireApproval: { type: Boolean, default: true },
    useMultipleLocations: { type: Boolean, default: true },
    maxAccuracyMeters: { type: Number, default: 150, min: 10, max: 5000 }
  },
  // Break Timings (when geofencing is paused)
  breakTimings: [{
    name: { type: String, trim: true },
    startTime: { type: String }, // Format: "HH:MM"
    endTime: { type: String }, // Format: "HH:MM"
    days: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    }],
    isActive: { type: Boolean, default: true }
  }],
  // Payroll Settings
  payroll: {
    workingDaysPerMonth: { type: Number, default: 26 },
    lateDeduction: {
      enabled: { type: Boolean, default: true },
      type: { type: String, enum: ['fixed', 'percentage', 'per-day-salary'], default: 'fixed' },
      value: { type: Number, default: 100 },
      graceLatesPerMonth: { type: Number, default: 3 }
    },
    halfDayDeduction: {
      enabled: { type: Boolean, default: true },
      type: { type: String, enum: ['fixed', 'percentage', 'half-day-salary'], default: 'half-day-salary' },
      value: { type: Number, default: 50 }
    },
    absentDeduction: {
      enabled: { type: Boolean, default: true },
      type: { type: String, enum: ['fixed', 'percentage', 'full-day-salary'], default: 'full-day-salary' },
      value: { type: Number, default: 100 }
    },
    overtime: {
      enabled: { type: Boolean, default: true },
      rateMultiplier: { type: Number, default: 1.5 },
      minHoursForOvertime: { type: Number, default: 1 }
    },
    pfEnabled: { type: Boolean, default: true },
    pfPercentage: { type: Number, default: 12 },
    esiEnabled: { type: Boolean, default: true },
    esiPercentage: { type: Number, default: 0.75 },
    professionalTax: {
      enabled: { type: Boolean, default: true },
      amount: { type: Number, default: 200 }
    },
    tdsEnabled: { type: Boolean, default: false }, // TDS disabled by default - must be configured manually
    tdsPercentage: { type: Number, default: 0 }
  },
  // Notification Settings
  notifications: {
    emailNotifications: { type: Boolean, default: true },
    pushNotifications: { type: Boolean, default: true },
    smsNotifications: { type: Boolean, default: false },
    emailEvents: {
      login: { type: Boolean, default: true },
      attendanceClockIn: { type: Boolean, default: true },
      attendanceStatusPresent: { type: Boolean, default: true },
      attendanceStatusHalfDay: { type: Boolean, default: true },
      attendanceStatusAbsent: { type: Boolean, default: true }
    },
    pushEvents: {
      login: { type: Boolean, default: true },
      attendanceClockIn: { type: Boolean, default: true },
      attendanceClockOut: { type: Boolean, default: true },
      taskAssigned: { type: Boolean, default: true },
      taskCompleted: { type: Boolean, default: true },
      leaveApplied: { type: Boolean, default: true },
      leaveApproved: { type: Boolean, default: true },
      leaveRejected: { type: Boolean, default: true },
      announcement: { type: Boolean, default: true }
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes - Note: name and code already have unique:true which creates indexes
CompanySchema.index({ isActive: 1 });

export default mongoose.models.Company || mongoose.model('Company', CompanySchema);
