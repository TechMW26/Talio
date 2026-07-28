import mongoose from 'mongoose';

const LeaveTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  code: {
    type: String,
    required: true,
    unique: true,
  },
  description: {
    type: String,
  },
  maxDaysPerYear: {
    type: Number,
    required: true,
  },
  daysPerYear: Number,
  carryForward: {
    type: Boolean,
    default: false,
  },
  maxCarryForwardDays: {
    type: Number,
    default: 0,
  },
  maxCarryForward: Number,
  isPaid: {
    type: Boolean,
    default: true,
  },
  requiresApproval: {
    type: Boolean,
    default: true,
  },
  requiresDocument: {
    type: Boolean,
    default: false,
  },
  minDaysNotice: {
    type: Number,
    default: 0,
  },
  minNoticeDays: Number,
  applicableGender: {
    type: String,
    enum: ['all', 'male', 'female'],
    default: 'all',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

LeaveTypeSchema.pre('validate', function (next) {
  this.maxDaysPerYear = Number(this.maxDaysPerYear ?? this.daysPerYear ?? 0) || 0
  this.daysPerYear = this.maxDaysPerYear
  this.maxCarryForwardDays = Number(this.maxCarryForwardDays ?? this.maxCarryForward ?? 0) || 0
  this.maxCarryForward = this.maxCarryForwardDays
  this.minDaysNotice = Number(this.minDaysNotice ?? this.minNoticeDays ?? 0) || 0
  this.minNoticeDays = this.minDaysNotice
  next()
})

export default mongoose.models.LeaveType || mongoose.model('LeaveType', LeaveTypeSchema);

