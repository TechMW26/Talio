import mongoose from 'mongoose'

const TodoCategorySchema = new mongoose.Schema({
  // Owner of the category
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Category details
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  // Color for visual distinction
  color: {
    type: String,
    default: '#6366f1' // Indigo default
  },
  // Icon (emoji or icon name)
  icon: {
    type: String,
    default: '📋'
  },
  // Description
  description: {
    type: String,
    trim: true,
    maxlength: 200
  },
  // Order in the tabs
  order: {
    type: Number,
    default: 0
  },
  // Is this a default category (can't be deleted)
  isDefault: {
    type: Boolean,
    default: false
  },
  // Soft delete
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
})

// Indexes
TodoCategorySchema.index({ user: 1, isDeleted: 1, order: 1 })
TodoCategorySchema.index({ user: 1, name: 1 }, { unique: true })

export default mongoose.models.TodoCategory || mongoose.model('TodoCategory', TodoCategorySchema)
