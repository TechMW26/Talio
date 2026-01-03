import mongoose from 'mongoose';

const KeystrokeLogSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sessionId: {
    type: String,
    required: true
  },
  // Keystroke data
  keystrokes: [{
    key: String,
    timestamp: Date,
    isSpecialKey: Boolean, // Ctrl, Alt, Shift, etc.
    modifiers: {
      ctrl: Boolean,
      alt: Boolean,
      shift: Boolean,
      meta: Boolean
    }
  }],
  // Reconstructed text for context
  textContent: {
    type: String,
    default: '',
    index: 'text' // Full-text search for MIRA context
  },
  // Application/Window context
  windowTitle: String,
  applicationName: String,
  url: String,
  domain: String,
  // Time tracking
  startTime: {
    type: Date,
    required: true
  },
  endTime: Date,
  duration: Number, // milliseconds
  // Metadata
  deviceInfo: {
    userAgent: String,
    platform: String,
    screenResolution: String
  },
  // Privacy & compliance
  isEncrypted: {
    type: Boolean,
    default: false
  },
  isPII: {
    type: Boolean,
    default: false // Flag if contains personally identifiable info
  },
  // Analytics
  keystrokeCount: {
    type: Number,
    default: 0
  },
  wordCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
KeystrokeLogSchema.index({ employee: 1, startTime: -1 });
KeystrokeLogSchema.index({ user: 1, startTime: -1 });
KeystrokeLogSchema.index({ sessionId: 1, startTime: -1 });
KeystrokeLogSchema.index({ createdAt: -1 });
KeystrokeLogSchema.index({ domain: 1, startTime: -1 });

// Virtual for productivity scoring
KeystrokeLogSchema.virtual('productivityScore').get(function() {
  if (!this.duration) return 0;
  const wpm = (this.wordCount / (this.duration / 60000)); // Words per minute
  return Math.min(100, Math.round(wpm * 2)); // Scale to 0-100
});

export default mongoose.models.KeystrokeLog || mongoose.model('KeystrokeLog', KeystrokeLogSchema);
