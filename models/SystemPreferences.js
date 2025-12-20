import mongoose from 'mongoose'

const systemPreferencesSchema = new mongoose.Schema({
  // Currency Settings
  currency: {
    type: String,
    enum: ['INR', 'USD', 'EUR', 'GBP'],
    default: 'INR',
  },
  currencySymbol: {
    type: String,
    default: '₹',
  },

  // Time Settings
  timeFormat: {
    type: String,
    enum: ['12', '24'],
    default: '12',
  },
  timezone: {
    type: String,
    default: 'Asia/Kolkata',
  },
  dateFormat: {
    type: String,
    enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
    default: 'DD/MM/YYYY',
  },

  // Work Settings
  workingDaysPerWeek: {
    type: Number,
    min: 1,
    max: 7,
    default: 5,
  },
  workingHoursPerDay: {
    type: Number,
    min: 1,
    max: 24,
    default: 8,
  },
  weekStartsOn: {
    type: String,
    enum: ['monday', 'sunday'],
    default: 'monday',
  },

  // Leave Settings
  defaultLeaveYear: {
    type: Number,
    default: () => new Date().getFullYear(),
  },
  leaveCarryForward: {
    type: Boolean,
    default: true,
  },
  maxCarryForwardDays: {
    type: Number,
    default: 10,
  },

  // Attendance Settings
  lateThresholdMinutes: {
    type: Number,
    default: 15,
  },
  halfDayThresholdHours: {
    type: Number,
    default: 4,
  },
  autoMarkAbsent: {
    type: Boolean,
    default: true,
  },

  // Notification Settings
  emailNotifications: {
    type: Boolean,
    default: true,
  },
  leaveApprovalNotifications: {
    type: Boolean,
    default: true,
  },
  attendanceReminders: {
    type: Boolean,
    default: true,
  },

  // Company Information
  companyName: {
    type: String,
    default: 'Your Company',
  },
  companyAddress: {
    type: String,
    default: '',
  },
  companyPhone: {
    type: String,
    default: '',
  },
  companyEmail: {
    type: String,
    default: '',
  },
  companyLogo: {
    type: String,
    default: '',
  },
  companyLogoFileId: {
    type: String, // ImageKit file ID for deletion
    default: '',
  },

  // System Settings
  maintenanceMode: {
    type: Boolean,
    default: false,
  },
  allowSelfRegistration: {
    type: Boolean,
    default: false,
  },
  passwordMinLength: {
    type: Number,
    default: 6,
  },
  sessionTimeout: {
    type: Number,
    default: 7, // days
  },
}, {
  timestamps: true,
})

// Ensure only one preferences document exists
systemPreferencesSchema.statics.getSingleton = async function () {
  let preferences = await this.findOne()
  if (!preferences) {
    preferences = new this()
    await preferences.save()
  }
  return preferences
}

// Method to get formatted currency
systemPreferencesSchema.methods.formatCurrency = function (amount) {
  return `${this.currencySymbol}${amount.toLocaleString()}`
}

// Method to get working days array
systemPreferencesSchema.methods.getWorkingDays = function () {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  const startIndex = this.weekStartsOn === 'sunday' ? 6 : 0
  const workingDays = []

  for (let i = 0; i < this.workingDaysPerWeek; i++) {
    workingDays.push(days[(startIndex + i) % 7])
  }

  return workingDays
}

export default mongoose.models.SystemPreferences || mongoose.model('SystemPreferences', systemPreferencesSchema)
