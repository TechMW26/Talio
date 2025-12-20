import mongoose from 'mongoose'

const HealthScoreSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
    unique: true
  },
  overallScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  attendanceScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  punctualityScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  performanceScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  leaveScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  // Detailed metrics
  metrics: {
    totalWorkingDays: { type: Number, default: 0 },
    presentDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    lateDays: { type: Number, default: 0 },
    halfDays: { type: Number, default: 0 },
    unapprovedLeaves: { type: Number, default: 0 },
    attendanceRate: { type: Number, default: 100 },
    punctualityRate: { type: Number, default: 100 },
    averagePerformanceRating: { type: Number, default: 5 },
    lastCalculated: { type: Date, default: Date.now }
  },
  // Risk indicators
  riskLevel: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'low'
  },
  salaryDeductionRisk: {
    type: Boolean,
    default: false
  },
  warnings: [{
    type: {
      type: String,
      enum: ['attendance', 'punctuality', 'performance', 'leave_abuse']
    },
    message: String,
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical']
    },
    date: { type: Date, default: Date.now },
    acknowledged: { type: Boolean, default: false }
  }],
  // Improvement tracking
  improvementPlan: {
    isActive: { type: Boolean, default: false },
    startDate: Date,
    endDate: Date,
    targetScore: Number,
    goals: [String],
    mentor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    }
  },
  // Historical data
  history: [{
    date: { type: Date, default: Date.now },
    overallScore: Number,
    attendanceScore: Number,
    punctualityScore: Number,
    performanceScore: Number,
    leaveScore: Number,
    notes: String
  }]
}, {
  timestamps: true
})

// Calculate overall health score
HealthScoreSchema.methods.calculateOverallScore = function() {
  const weights = {
    attendance: 0.4,    // 40% weight
    punctuality: 0.25,  // 25% weight
    performance: 0.25,  // 25% weight
    leave: 0.1          // 10% weight
  }
  
  this.overallScore = Math.round(
    (this.attendanceScore * weights.attendance) +
    (this.punctualityScore * weights.punctuality) +
    (this.performanceScore * weights.performance) +
    (this.leaveScore * weights.leave)
  )
  
  // Determine risk level
  if (this.overallScore >= 90) this.riskLevel = 'low'
  else if (this.overallScore >= 75) this.riskLevel = 'medium'
  else if (this.overallScore >= 60) this.riskLevel = 'high'
  else this.riskLevel = 'critical'
  
  // Check salary deduction risk
  this.salaryDeductionRisk = this.overallScore < 70 || 
                            this.attendanceScore < 75 || 
                            this.punctualityScore < 70
  
  return this.overallScore
}

// Add warning
HealthScoreSchema.methods.addWarning = function(type, message, severity = 'medium') {
  this.warnings.push({
    type,
    message,
    severity,
    date: new Date(),
    acknowledged: false
  })
  
  // Keep only last 10 warnings
  if (this.warnings.length > 10) {
    this.warnings = this.warnings.slice(-10)
  }
}

// Save to history
HealthScoreSchema.methods.saveToHistory = function(notes = '') {
  this.history.push({
    date: new Date(),
    overallScore: this.overallScore,
    attendanceScore: this.attendanceScore,
    punctualityScore: this.punctualityScore,
    performanceScore: this.performanceScore,
    leaveScore: this.leaveScore,
    notes
  })
  
  // Keep only last 12 months of history
  if (this.history.length > 12) {
    this.history = this.history.slice(-12)
  }
}

// Indexes for performance
HealthScoreSchema.index({ overallScore: -1 })
HealthScoreSchema.index({ riskLevel: 1 })
HealthScoreSchema.index({ salaryDeductionRisk: 1 })

export default mongoose.models.HealthScore || mongoose.model('HealthScore', HealthScoreSchema)
