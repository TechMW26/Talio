import mongoose from 'mongoose';

const GeofenceLocationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  address: {
    type: String,
    trim: true,
  },
  center: {
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
  },
  radius: {
    type: Number, // Radius in meters
    required: true,
    default: 100,
    min: 10,
  },
  scope: {
    type: String,
    enum: ['organisation', 'company'],
    default: 'organisation',
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  isPrimary: {
    type: Boolean,
    default: false, // Only one location can be primary
  },
  // Location-specific settings
  strictMode: {
    type: Boolean,
    default: false, // If true, employees must be within this geofence to check in
  },
  allowedDepartments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  }],
  allowedEmployees: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  }],
  // Working hours specific to this location (optional, falls back to company settings)
  workingHours: {
    checkInTime: String, // Format: "HH:MM"
    checkOutTime: String, // Format: "HH:MM"
    workingDays: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    }],
  },
  // Break timings when geofencing is paused
  breakTimings: [{
    name: {
      type: String,
      required: true,
      trim: true,
    },
    startTime: {
      type: String, // Format: "HH:MM"
      required: true,
    },
    endTime: {
      type: String, // Format: "HH:MM"
      required: true,
    },
    days: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    }],
    isActive: {
      type: Boolean,
      default: true,
    },
  }],
  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  },
  // Statistics
  stats: {
    totalCheckIns: {
      type: Number,
      default: 0,
    },
    lastCheckInAt: Date,
  },
}, {
  timestamps: true,
});

// Index for efficient queries
GeofenceLocationSchema.index({ isActive: 1, isPrimary: 1 });
GeofenceLocationSchema.index({ company: 1, isActive: 1 });
GeofenceLocationSchema.index({ 'center.latitude': 1, 'center.longitude': 1 });

// Ensure only one primary location
GeofenceLocationSchema.pre('save', async function(next) {
  if (this.isPrimary && this.isModified('isPrimary')) {
    // Remove primary flag from other locations
    await mongoose.models.GeofenceLocation.updateMany(
      { _id: { $ne: this._id }, isPrimary: true },
      { $set: { isPrimary: false } }
    );
  }
  next();
});

export default mongoose.models.GeofenceLocation || mongoose.model('GeofenceLocation', GeofenceLocationSchema);

