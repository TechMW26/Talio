import mongoose from 'mongoose';

const HolidaySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  type: {
    type: String,
    enum: ['public', 'company'],
    default: 'public',
  },
  description: {
    type: String,
  },
  applicableTo: {
    type: String,
    enum: ['all', 'specific-locations'],
    default: 'all',
  },
  locations: [String],
  year: {
    type: Number,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  // Enhanced fields
  endDate: {
    type: Date // For multi-day holidays
  },
  category: {
    type: String,
    enum: ['public', 'religious', 'cultural', 'company_specific', 'festival'],
    default: 'public'
  },
  isOptional: {
    type: Boolean,
    default: false
  },
  isFloating: {
    type: Boolean,
    default: false
  },
  // Applicability
  applicableFor: {
    departments: [String],
    designations: [String],
    employeeTypes: [{
      type: String,
      enum: ['permanent', 'contract', 'intern', 'consultant']
    }],
    allEmployees: {
      type: Boolean,
      default: true
    }
  },
  // Recurring holiday settings
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurrencePattern: {
    type: String,
    enum: ['yearly', 'monthly', 'custom'],
    default: 'yearly'
  },
  // Compensation settings
  compensation: {
    isPaid: {
      type: Boolean,
      default: true
    },
    overtimeMultiplier: {
      type: Number,
      default: 2.0
    },
    compensatoryOffAllowed: {
      type: Boolean,
      default: false
    }
  },
  // Notification settings
  notifications: {
    enabled: {
      type: Boolean,
      default: true
    },
    reminderDays: {
      type: Number,
      default: 3
    }
  },
  // Administrative
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  approvedAt: Date,
  // Tags for organization
  tags: [String]
}, {
  timestamps: true,
});

// Virtual for duration in days
HolidaySchema.virtual('duration').get(function () {
  if (!this.endDate) return 1
  const start = new Date(this.date)
  const end = new Date(this.endDate)
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
})

// Virtual for days until holiday
HolidaySchema.virtual('daysUntil').get(function () {
  const today = new Date()
  const holidayDate = new Date(this.date)
  const timeDiff = holidayDate.getTime() - today.getTime()
  return Math.ceil(timeDiff / (1000 * 60 * 60 * 24))
})

// Check if holiday is applicable for employee
HolidaySchema.methods.isApplicableFor = function (employee) {
  if (this.applicableFor.allEmployees) return true

  const { departments, designations, employeeTypes } = this.applicableFor

  if (departments.length > 0 && !departments.includes(employee.department)) {
    return false
  }

  if (designations.length > 0 && !designations.includes(employee.designation)) {
    return false
  }

  if (employeeTypes.length > 0 && !employeeTypes.includes(employee.employeeType)) {
    return false
  }

  return true
}

// Indexes
HolidaySchema.index({ date: 1, year: 1 })
HolidaySchema.index({ type: 1, isActive: 1 })
HolidaySchema.index({ year: 1, isActive: 1 })

export default mongoose.models.Holiday || mongoose.model('Holiday', HolidaySchema);

