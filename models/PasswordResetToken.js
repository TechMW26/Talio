import mongoose from 'mongoose'
import crypto from 'crypto'

const passwordResetTokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  
  token: {
    type: String,
    required: true,
    unique: true,
  },
  
  // Hashed token for secure storage
  tokenHash: {
    type: String,
    required: true,
  },
  
  expiresAt: {
    type: Date,
    required: true,
  },
  
  // Track if token has been used
  usedAt: Date,
  
  // IP and user agent for security logging
  requestedFromIp: String,
  requestedUserAgent: String,
  
  // Used from (for logging)
  usedFromIp: String,
  usedUserAgent: String,
  
}, {
  timestamps: true,
})

// Index for cleanup and lookups
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
passwordResetTokenSchema.index({ user: 1, createdAt: -1 })
passwordResetTokenSchema.index({ tokenHash: 1 })

// Static method to generate a reset token
passwordResetTokenSchema.statics.generateToken = function() {
  // Generate a random token (URL-safe)
  const token = crypto.randomBytes(32).toString('base64url')
  // Hash the token for storage
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  return { token, tokenHash }
}

// Static method to hash a token for lookup
passwordResetTokenSchema.statics.hashToken = function(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// Check if token is valid (not expired, not used)
passwordResetTokenSchema.methods.isValid = function() {
  return !this.usedAt && this.expiresAt > new Date()
}

const PasswordResetToken = mongoose.models.PasswordResetToken || mongoose.model('PasswordResetToken', passwordResetTokenSchema)

export default PasswordResetToken
