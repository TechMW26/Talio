import mongoose from 'mongoose';

const DocumentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  category: {
    type: String,
    enum: ['policy', 'form', 'certificate', 'contract', 'letter', 'report', 'other'],
    required: true,
  },
  fileName: {
    type: String,
    required: true,
  },
  fileUrl: {
    type: String,
    required: true,
  },
  fileId: {
    type: String, // ImageKit file ID for deletion
  },
  fileSize: {
    type: Number,
  },
  fileType: {
    type: String,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  },
  accessLevel: {
    type: String,
    enum: ['public', 'department', 'private'],
    default: 'public',
  },
  sharedWith: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  }],
  version: {
    type: Number,
    default: 1,
  },
  previousVersions: [{
    version: Number,
    fileUrl: String,
    uploadedDate: Date,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  }],
  requiresAcknowledgment: {
    type: Boolean,
    default: false,
  },
  acknowledgments: [{
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    acknowledgedDate: Date,
  }],
  expiryDate: {
    type: Date,
  },
  tags: [String],
  status: {
    type: String,
    enum: ['active', 'archived', 'deleted'],
    default: 'active',
  },
}, {
  timestamps: true,
});

export default mongoose.models.Document || mongoose.model('Document', DocumentSchema);

