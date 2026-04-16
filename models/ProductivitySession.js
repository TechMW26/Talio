import mongoose from 'mongoose';

/**
 * ProductivitySession Model
 * Stores groups of 60 screenshots (3-min intervals, 180-min sessions) with AI analysis
 */
const ProductivitySessionSchema = new mongoose.Schema({
  // User who owns this session
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Employee reference for team queries
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    index: true
  },

  // Date of the session (YYYY-MM-DD)
  date: {
    type: Date,
    required: true,
    index: true
  },

  // Session number for the day (1, 2, 3, etc.)
  sessionNumber: {
    type: Number,
    required: true,
    default: 1
  },

  // Screenshots in this session (URLs/paths)
  screenshots: [{
    path: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      required: true
    },
    filename: String,
    captureType: {
      type: String,
      enum: ['automatic', 'manual'],
      default: 'automatic'
    },
    isOfflineCapture: {
      type: Boolean,
      default: false
    },
    capturedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    capturedByRole: String
  }],

  // Time range
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },

  // Estimated duration in minutes
  estimatedDuration: {
    type: Number,
    default: 0
  },

  // AI Analysis results
  analysis: {
    isAnalyzed: {
      type: Boolean,
      default: false
    },
    analyzedAt: Date,

    // Overall summary
    summary: {
      type: String,
      default: ''
    },

    // Productivity score (0-100)
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: null
    },

    // Focus score (0-100)
    focusScore: {
      type: Number,
      min: 0,
      max: 100,
      default: null
    },

    // Task completion indicators (0-100)
    taskCompletionIndicators: {
      type: Number,
      min: 0,
      max: 100,
      default: null
    },

    // Time distribution percentages
    timeDistribution: {
      deepWork: { type: Number, default: 0 },
      collaboration: { type: Number, default: 0 },
      administrative: { type: Number, default: 0 },
      breaks: { type: Number, default: 0 },
      unfocused: { type: Number, default: 0 }
    },

    // Focus metrics
    focusMetrics: {
      longestFocusStreak: { type: String },
      contextSwitches: { type: Number, default: 0 },
      distractionCount: { type: Number, default: 0 }
    },

    // Key achievements during this session
    achievements: [{
      type: String
    }],

    // Improvement suggestions
    suggestions: [{
      type: String
    }],

    // Key insights/observations
    insights: [{
      type: String
    }],

    // Concerns identified
    concerns: [{
      type: String
    }],

    // Work categories breakdown
    workCategories: [{
      category: String,
      percentage: Number,
      description: String
    }],

    // Individual screenshot summaries (legacy)
    screenshotSummaries: [{
      screenshotPath: String,
      timestamp: Date,
      summary: String,
      activity: String, // coding, browsing, meeting, etc.
      productivity: String // high, medium, low, idle
    }],

    // Per-screenshot analysis (new format)
    screenshotAnalysis: [{
      index: Number,
      timestamp: String,
      summary: String,
      activity: String,
      productivity: String,
      applicationVisible: String,
      websiteVisible: String,
      taskDescription: String
    }],

    // Detected applications/activities (legacy)
    detectedApplications: [{
      name: String,
      duration: Number, // minutes
      category: String // work, communication, entertainment, etc.
    }],

    // Applications (new format)
    applications: [{
      name: String,
      category: String,
      estimatedMinutes: Number,
      productivityImpact: String
    }],

    // Websites visited
    websites: [{
      domain: String,
      category: String,
      estimatedMinutes: Number
    }],

    // Overall assessment
    overallAssessment: {
      strengths: [{ type: String }],
      areasForImprovement: [{ type: String }],
      recommendation: String
    },

    // Error if analysis failed
    error: String
  },

  // Metadata
  screenshotCount: {
    type: Number,
    default: 0
  },

  isComplete: {
    type: Boolean,
    default: false // true when session has 60 screenshots (3-min intervals, 180-min session)
  },

  // Cleanup tracking - screenshots deleted after AI analysis
  screenshotsDeleted: {
    type: Boolean,
    default: false
  },
  screenshotsDeletedAt: Date
}, {
  timestamps: true
});

// Compound index for efficient queries
ProductivitySessionSchema.index({ user: 1, date: -1 });
ProductivitySessionSchema.index({ employee: 1, date: -1 });
ProductivitySessionSchema.index({ date: -1, sessionNumber: 1 });

// Virtual for formatted date
ProductivitySessionSchema.virtual('formattedDate').get(function () {
  return this.date.toISOString().split('T')[0];
});

// Virtual for time range string
ProductivitySessionSchema.virtual('timeRange').get(function () {
  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };
  return `${formatTime(this.startTime)} - ${formatTime(this.endTime)}`;
});

// Include virtuals in JSON
ProductivitySessionSchema.set('toJSON', { virtuals: true });
ProductivitySessionSchema.set('toObject', { virtuals: true });

// Pre-save hook to calculate duration and screenshot count
ProductivitySessionSchema.pre('save', function (next) {
  if (this.screenshots && this.screenshots.length > 0) {
    this.screenshotCount = this.screenshots.length;

    // Calculate estimated duration based on screenshot timestamps
    const times = this.screenshots.map(s => new Date(s.timestamp).getTime()).sort((a, b) => a - b);
    if (times.length > 1) {
      this.estimatedDuration = Math.round((times[times.length - 1] - times[0]) / (1000 * 60));
    } else {
      this.estimatedDuration = 1; // Single screenshot = 1 minute
    }

    // Mark as complete if 60 or more screenshots
    this.isComplete = this.screenshots.length >= 60;
  }
  next();
});

export default mongoose.models.ProductivitySession || mongoose.model('ProductivitySession', ProductivitySessionSchema);
