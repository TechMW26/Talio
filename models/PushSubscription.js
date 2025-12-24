import mongoose from 'mongoose'

const pushSubscriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    index: true
  },
  endpoint: {
    type: String,
    required: true,
    index: true
  },
  keys: {
    p256dh: {
      type: String,
      required: true
    },
    auth: {
      type: String,
      required: true
    }
  },
  platform: {
    type: String,
    enum: ['web', 'android', 'ios'],
    default: 'web'
  },
  deviceInfo: {
    userAgent: String,
    platform: String,
    browser: String,
    os: String,
    deviceType: String // 'desktop', 'mobile', 'tablet'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  failureCount: {
    type: Number,
    default: 0
  },
  lastFailure: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastUsed: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
})

// Compound index for user and endpoint
pushSubscriptionSchema.index({ user: 1, endpoint: 1 }, { unique: true })

// Update lastUsed timestamp
pushSubscriptionSchema.methods.updateLastUsed = function () {
  this.lastUsed = new Date()
  return this.save()
}

const PushSubscription = mongoose.models.PushSubscription || mongoose.model('PushSubscription', pushSubscriptionSchema)

export default PushSubscription

