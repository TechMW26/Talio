import mongoose from 'mongoose';

/**
 * Screenshot Model
 * Stores screenshot metadata - actual image data is in GridFS
 * Screenshots are auto-deleted after 7 days, but analytics are preserved
 */
const ScreenshotSchema = new mongoose.Schema({
  // User who owns this screenshot
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
  
  // GridFS file ID for the actual image
  gridfsFileId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  
  // Capture timestamp
  capturedAt: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  
  // Date string for easy querying (YYYY-MM-DD)
  dateString: {
    type: String,
    required: true,
    index: true
  },
  
  // Image metadata
  metadata: {
    mimeType: {
      type: String,
      default: 'image/png'
    },
    width: Number,
    height: Number,
    fileSize: Number, // in bytes
    format: String // png, jpeg, etc.
  },
  
  // Activity data at time of capture
  activity: {
    activeWindow: String,
    activeApp: String,
    keystrokes: {
      type: Number,
      default: 0
    },
    mouseClicks: {
      type: Number,
      default: 0
    },
    mouseMovements: {
      type: Number,
      default: 0
    },
    isIdle: {
      type: Boolean,
      default: false
    }
  },
  
  // Session reference (for grouping)
  sessionId: {
    type: String,
    index: true
  },
  
  // Flag for cleanup
  markedForDeletion: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
ScreenshotSchema.index({ user: 1, capturedAt: -1 });
ScreenshotSchema.index({ user: 1, dateString: 1 });
ScreenshotSchema.index({ employee: 1, dateString: 1 });
ScreenshotSchema.index({ capturedAt: 1 }); // For cleanup queries

// TTL index - auto-delete after 7 days (backup to manual cleanup)
// Note: This only deletes the metadata document, GridFS files are cleaned separately
ScreenshotSchema.index({ capturedAt: 1 }, { expireAfterSeconds: 604800 }); // 7 days

// Virtual for formatted time
ScreenshotSchema.virtual('formattedTime').get(function() {
  return new Date(this.capturedAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
});

// Include virtuals in JSON
ScreenshotSchema.set('toJSON', { virtuals: true });
ScreenshotSchema.set('toObject', { virtuals: true });

export default mongoose.models.Screenshot || mongoose.model('Screenshot', ScreenshotSchema);
