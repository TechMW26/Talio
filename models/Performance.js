import mongoose from 'mongoose';

const PerformanceSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  reviewPeriod: {
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
  },
  reviewType: {
    type: String,
    enum: ['quarterly', 'half-yearly', 'annual', 'probation'],
    required: true,
  },
  reviewer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  kras: [{
    title: String,
    description: String,
    weightage: Number,
    target: String,
    achievement: String,
    rating: Number,
    comments: String,
  }],
  kpis: [{
    title: String,
    description: String,
    target: Number,
    achieved: Number,
    unit: String,
    rating: Number,
    comments: String,
  }],
  competencies: [{
    name: String,
    description: String,
    rating: Number,
    comments: String,
  }],
  overallRating: {
    type: Number,
    min: 1,
    max: 5,
  },
  strengths: {
    type: String,
  },
  areasOfImprovement: {
    type: String,
  },
  trainingRecommendations: [{
    type: String,
  }],
  goals: [{
    title: String,
    description: String,
    targetDate: Date,
    status: {
      type: String,
      enum: ['not-started', 'in-progress', 'completed'],
      default: 'not-started',
    },
  }],
  employeeComments: {
    type: String,
  },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'acknowledged', 'completed'],
    default: 'draft',
  },
  submittedDate: {
    type: Date,
  },
  acknowledgedDate: {
    type: Date,
  },
}, {
  timestamps: true,
});

PerformanceSchema.index({ employee: 1, createdAt: -1 });
PerformanceSchema.index({ employee: 1, isActive: 1, createdAt: -1 });

export default mongoose.models.Performance || mongoose.model('Performance', PerformanceSchema);

