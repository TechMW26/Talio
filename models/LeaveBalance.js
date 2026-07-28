import mongoose from 'mongoose';

const LeaveBalanceSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  leaveType: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LeaveType',
    required: true,
  },
  year: {
    type: Number,
    required: true,
  },
  totalDays: {
    type: Number,
    required: true,
  },
  usedDays: {
    type: Number,
    default: 0,
  },
  remainingDays: {
    type: Number,
    required: true,
  },
  carriedForward: {
    type: Number,
    default: 0,
  },
  allocated: Number,
  used: Number,
  pending: {
    type: Number,
    default: 0,
  },
  balance: Number,
}, {
  timestamps: true,
});

LeaveBalanceSchema.pre('validate', function (next) {
  const totalDays = Number(this.totalDays ?? this.allocated ?? 0) || 0
  const usedDays = Number(this.usedDays ?? this.used ?? 0) || 0
  const pending = Number(this.pending ?? 0) || 0
  const carriedForward = Number(this.carriedForward ?? 0) || 0
  const remainingDays = Number(
    this.remainingDays ??
    this.balance ??
    Math.max(0, totalDays + carriedForward - usedDays - pending)
  ) || 0

  this.totalDays = totalDays
  this.allocated = totalDays
  this.usedDays = usedDays
  this.used = usedDays
  this.remainingDays = Math.max(0, remainingDays)
  this.balance = this.remainingDays
  next()
})

// Compound index
LeaveBalanceSchema.index({ employee: 1, leaveType: 1, year: 1 }, { unique: true });

export default mongoose.models.LeaveBalance || mongoose.model('LeaveBalance', LeaveBalanceSchema);

