import mongoose from 'mongoose'

const userSessionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  
  // JWT token identifier (jti claim or hash of token)
  tokenId: {
    type: String,
    required: true,
    unique: true,
  },
  
  // Device/browser info
  deviceInfo: {
    userAgent: String,
    browser: String,
    browserVersion: String,
    os: String,
    osVersion: String,
    device: String, // desktop, mobile, tablet
    deviceType: String, // Desktop App, Android App, Web Browser
  },
  
  // Location info
  ipAddress: String,
  location: {
    city: String,
    country: String,
  },
  
  // Session status
  isActive: {
    type: Boolean,
    default: true,
  },
  
  // Timestamps
  lastActivityAt: {
    type: Date,
    default: Date.now,
  },
  
  expiresAt: {
    type: Date,
    required: true,
  },
  
  // Revocation info
  revokedAt: Date,
  revokedReason: {
    type: String,
    enum: ['user_logout', 'password_change', 'admin_revoke', 'session_expired', 'security_concern'],
  },
  
}, {
  timestamps: true,
})

// Indexes for efficient queries
userSessionSchema.index({ user: 1, isActive: 1 })
userSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

// Static method to parse user agent
userSessionSchema.statics.parseUserAgent = function(userAgentString) {
  if (!userAgentString) {
    return {
      userAgent: 'Unknown',
      browser: 'Unknown',
      browserVersion: '',
      os: 'Unknown',
      osVersion: '',
      device: 'desktop',
      deviceType: 'Web Browser',
    }
  }

  const ua = userAgentString.toLowerCase()
  
  // Detect device type
  let device = 'desktop'
  let deviceType = 'Web Browser'
  
  if (ua.includes('talio desktop') || ua.includes('electron')) {
    deviceType = 'Desktop App'
    device = 'desktop'
  } else if (ua.includes('talio android') || ua.includes('talio-android')) {
    deviceType = 'Android App'
    device = 'mobile'
  } else if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    device = 'mobile'
  } else if (ua.includes('tablet') || ua.includes('ipad')) {
    device = 'tablet'
  }
  
  // Detect browser
  let browser = 'Unknown'
  let browserVersion = ''
  
  if (ua.includes('electron')) {
    browser = 'Talio Desktop'
    const match = ua.match(/electron\/(\d+[\d.]*)/i)
    browserVersion = match ? match[1] : ''
  } else if (ua.includes('edg/')) {
    browser = 'Edge'
    const match = ua.match(/edg\/(\d+[\d.]*)/i)
    browserVersion = match ? match[1] : ''
  } else if (ua.includes('chrome')) {
    browser = 'Chrome'
    const match = ua.match(/chrome\/(\d+[\d.]*)/i)
    browserVersion = match ? match[1] : ''
  } else if (ua.includes('firefox')) {
    browser = 'Firefox'
    const match = ua.match(/firefox\/(\d+[\d.]*)/i)
    browserVersion = match ? match[1] : ''
  } else if (ua.includes('safari') && !ua.includes('chrome')) {
    browser = 'Safari'
    const match = ua.match(/version\/(\d+[\d.]*)/i)
    browserVersion = match ? match[1] : ''
  }
  
  // Detect OS
  let os = 'Unknown'
  let osVersion = ''
  
  if (ua.includes('windows')) {
    os = 'Windows'
    if (ua.includes('windows nt 10')) osVersion = '10/11'
    else if (ua.includes('windows nt 6.3')) osVersion = '8.1'
    else if (ua.includes('windows nt 6.2')) osVersion = '8'
    else if (ua.includes('windows nt 6.1')) osVersion = '7'
  } else if (ua.includes('mac os x') || ua.includes('macos')) {
    os = 'macOS'
    const match = ua.match(/mac os x (\d+[._]\d+)/i)
    osVersion = match ? match[1].replace('_', '.') : ''
  } else if (ua.includes('linux')) {
    os = 'Linux'
  } else if (ua.includes('android')) {
    os = 'Android'
    const match = ua.match(/android (\d+[\d.]*)/i)
    osVersion = match ? match[1] : ''
  } else if (ua.includes('iphone') || ua.includes('ipad')) {
    os = 'iOS'
    const match = ua.match(/os (\d+[_\d]*)/i)
    osVersion = match ? match[1].replace(/_/g, '.') : ''
  }
  
  return {
    userAgent: userAgentString,
    browser,
    browserVersion,
    os,
    osVersion,
    device,
    deviceType,
  }
}

// Method to check if session is valid
userSessionSchema.methods.isValid = function() {
  return this.isActive && this.expiresAt > new Date()
}

// Method to revoke session
userSessionSchema.methods.revoke = async function(reason = 'user_logout') {
  this.isActive = false
  this.revokedAt = new Date()
  this.revokedReason = reason
  await this.save()
}

const UserSession = mongoose.models.UserSession || mongoose.model('UserSession', userSessionSchema)

export default UserSession
