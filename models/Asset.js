import mongoose from 'mongoose';

const AssetSchema = new mongoose.Schema({
  billDate: Date,
  billNumber: String,
  billFrom: String,
  billPayFromLOB: String,
  vertical: String,
  center: String,
  warrantyStatus: String,
  replacementDate: Date,
  box: { type: Boolean, default: null },
  charger: { type: Boolean, default: null },
  history: [{
    at: { type: Date, required: true },
    actor: String,
    actorName: String,
    action: String,
    changes: [{ field: String, before: mongoose.Schema.Types.Mixed, after: mongoose.Schema.Types.Mixed }],
  }],
  assetCode: {
    type: String,
    required: true,
    unique: true,
  },
  uin: {
    type: String,
    unique: true,
    sparse: true, // Allows null/undefined to not conflict
  },
  name: {
    type: String,
    required: true,
  },
  specs: {
    type: String,
  },
  category: {
    type: String,
    enum: ['laptop', 'desktop', 'mobile', 'tablet', 'monitor', 'keyboard', 'mouse', 'furniture', 'vehicle', 'other'],
    required: true,
  },
  description: {
    type: String,
  },
  serialNumber: {
    type: String,
  },
  manufacturer: {
    type: String,
  },
  model: {
    type: String,
  },
  purchaseDate: {
    type: Date,
  },
  purchasePrice: {
    type: Number,
  },
  warrantyExpiry: {
    type: Date,
  },
  status: {
    type: String,
    enum: ['available', 'assigned', 'returned', 'not-working', 'not-match', 'under-maintenance', 'damaged', 'disposed'],
    default: 'available',
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  },
  assignedDate: {
    type: Date,
  },
  returnDate: {
    type: Date,
  },
  location: {
    type: String,
  },
  condition: {
    type: String,
    enum: ['excellent', 'good', 'fair', 'poor'],
    default: 'good',
  },
  maintenanceHistory: [{
    date: Date,
    description: String,
    cost: Number,
    performedBy: String,
  }],
  documents: [{
    name: String,
    url: String,
    uploadedAt: Date,
  }],
  remarks: {
    type: String,
  },
}, {
  timestamps: true,
});

export default mongoose.models.Asset || mongoose.model('Asset', AssetSchema);

