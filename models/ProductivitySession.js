import mongoose from 'mongoose';

/**
 * ProductivitySession Model
 * Stores groups of 30 screenshots as sessions with AI analysis
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
    
    // Individual screenshot summaries
    screenshotSummaries: [{
      screenshotPath: String,
      timestamp: Date,
      summary: String,
      activity: String, // coding, browsing, meeting, etc.
      productivity: String // high, medium, low, idle
    }],
    
    // Detected applications/activities
    detectedApplications: [{
      name: String,
      duration: Number, // minutes
      category: String // work, communication, entertainment, etc.
    }],
    
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
    default: false // true when session has 30 screenshots
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
ProductivitySessionSchema.index({ user: 1, date: -1 });
ProductivitySessionSchema.index({ employee: 1, date: -1 });
ProductivitySessionSchema.index({ date: -1, sessionNumber: 1 });

// Virtual for formatted date
ProductivitySessionSchema.virtual('formattedDate').get(function() {
  return this.date.toISOString().split('T')[0];
});

// Virtual for time range string
ProductivitySessionSchema.virtual('timeRange').get(function() {
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
ProductivitySessionSchema.pre('save', function(next) {
  if (this.screenshots && this.screenshots.length > 0) {
    this.screenshotCount = this.screenshots.length;
    
    // Calculate estimated duration based on screenshot timestamps
    const times = this.screenshots.map(s => new Date(s.timestamp).getTime()).sort((a, b) => a - b);
    if (times.length > 1) {
      this.estimatedDuration = Math.round((times[times.length - 1] - times[0]) / (1000 * 60));
    } else {
      this.estimatedDuration = 1; // Single screenshot = 1 minute
    }
    
    // Mark as complete if 30 or more screenshots
    this.isComplete = this.screenshots.length >= 30;
  }
  next();
});

export default mongoose.models.ProductivitySession || mongoose.model('ProductivitySession', ProductivitySessionSchema);
