import mongoose from 'mongoose';

/**
 * ScreenshotAnalysis Model
 * Stores daily AI analysis of screenshots - persists after screenshot deletion
 * Contains timeline, summary, productivity metrics, and insights
 */
const ScreenshotAnalysisSchema = new mongoose.Schema({
  // User who owns this analysis
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Employee reference
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    index: true
  },
  
  // Date of analysis (YYYY-MM-DD)
  dateString: {
    type: String,
    required: true,
    index: true
  },
  
  // Analysis date as Date object
  date: {
    type: Date,
    required: true,
    index: true
  },
  
  // Employee context at time of analysis
  employeeContext: {
    name: String,
    designation: String,
    department: String,
    expectedWorkflow: String // AI-inferred expected activities based on role
  },
  
  // Screenshot count for the day
  screenshotCount: {
    type: Number,
    default: 0
  },
  
  // Time range
  firstCapture: Date,
  lastCapture: Date,
  totalActiveMinutes: {
    type: Number,
    default: 0
  },
  
  // AI-generated timeline
  timeline: [{
    startTime: Date,
    endTime: Date,
    duration: Number, // minutes
    activity: String, // What the user was doing
    category: {
      type: String,
      enum: ['work', 'communication', 'meeting', 'break', 'idle', 'entertainment', 'research', 'other']
    },
    productivity: {
      type: String,
      enum: ['high', 'medium', 'low', 'idle']
    },
    applications: [String],
    description: String
  }],
  
  // AI-generated summary
  summary: {
    overview: String, // 2-3 sentence summary of the day
    keyActivities: [String], // Bullet points of main activities
    achievements: [String], // What was accomplished
    concerns: [String], // Potential issues noticed
    recommendations: [String] // Suggestions for improvement
  },
  
  // Productivity metrics
  metrics: {
    overallScore: {
      type: Number,
      min: 0,
      max: 100
    },
    focusScore: {
      type: Number,
      min: 0,
      max: 100
    },
    activityScore: {
      type: Number,
      min: 0,
      max: 100
    },
    consistencyScore: {
      type: Number,
      min: 0,
      max: 100
    }
  },
  
  // Application usage breakdown
  applicationUsage: [{
    name: String,
    category: String,
    duration: Number, // minutes
    percentage: Number // of total time
  }],
  
  // Category time breakdown
  categoryBreakdown: [{
    category: String,
    duration: Number, // minutes
    percentage: Number
  }],
  
  // Hourly activity heatmap (0-23)
  hourlyActivity: [{
    hour: Number,
    screenshotCount: Number,
    avgProductivity: String,
    isActive: Boolean
  }],
  
  // Individual screenshot analyses (kept for reference)
  screenshotAnalyses: [{
    screenshotId: mongoose.Schema.Types.ObjectId,
    capturedAt: Date,
    summary: String,
    detectedContent: [String], // What AI saw in the screenshot
    activity: String,
    productivity: String,
    application: String
  }],
  
  // Analysis status
  status: {
    type: String,
    enum: ['pending', 'analyzing', 'completed', 'failed', 'partial'],
    default: 'pending'
  },
  
  // Analysis metadata
  analyzedAt: Date,
  analysisVersion: {
    type: String,
    default: '1.0'
  },
  aiModel: String, // Which AI model was used
  processingTime: Number, // milliseconds
  error: String // If analysis failed
  
}, {
  timestamps: true
});

// Compound indexes
ScreenshotAnalysisSchema.index({ user: 1, dateString: 1 }, { unique: true });
ScreenshotAnalysisSchema.index({ employee: 1, date: -1 });
ScreenshotAnalysisSchema.index({ date: -1 });
ScreenshotAnalysisSchema.index({ status: 1, date: -1 });

// Virtual for formatted date
ScreenshotAnalysisSchema.virtual('formattedDate').get(function() {
  return new Date(this.date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
});

// Virtual for work duration string
ScreenshotAnalysisSchema.virtual('workDuration').get(function() {
  const hours = Math.floor(this.totalActiveMinutes / 60);
  const minutes = this.totalActiveMinutes % 60;
  return `${hours}h ${minutes}m`;
});

// Include virtuals in JSON
ScreenshotAnalysisSchema.set('toJSON', { virtuals: true });
ScreenshotAnalysisSchema.set('toObject', { virtuals: true });

export default mongoose.models.ScreenshotAnalysis || mongoose.model('ScreenshotAnalysis', ScreenshotAnalysisSchema);
