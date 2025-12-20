import mongoose from 'mongoose'

const MessageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  content: {
    type: String,
    required: function () {
      return !this.fileUrl
    }
  },
  fileUrl: {
    type: String
  },
  fileId: {
    type: String // ImageKit file ID for deletion
  },
  fileName: {
    type: String
  },
  fileType: {
    type: String
  },
  fileSize: {
    type: Number
  },
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  reactions: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    reaction: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  isRead: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
})

const ChatSchema = new mongoose.Schema({
  name: {
    type: String,
    required: function () {
      return this.isGroup
    }
  },
  isGroup: {
    type: Boolean,
    default: false
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  }],
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  messages: [MessageSchema],
  lastMessage: {
    type: String
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
})

// Index for faster queries
ChatSchema.index({ participants: 1 })
ChatSchema.index({ lastMessageAt: -1 })

export default mongoose.models.Chat || mongoose.model('Chat', ChatSchema)

