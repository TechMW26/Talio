import mongoose from 'mongoose';

const GeofenceLogSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  
  // Event Type
  eventType: {
    type: String,
    enum: ['exit', 'entry', 'outside_during_hours', 'location_update', 'attendance_check_in', 'attendance_check_out'],
    required: true,
  },
  
  // Location Data
  location: {
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    accuracy: Number, // Accuracy in meters
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  
  // Geofence Data
  geofenceCenter: {
    latitude: Number,
    longitude: Number,
  },
  geofenceRadius: Number, // Radius in meters
  distanceFromCenter: Number, // Distance in meters
  isWithinGeofence: {
    type: Boolean,
    required: true,
  },
  // Multiple locations support
  geofenceLocation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GeofenceLocation',
  },
  geofenceLocationName: String, // Cached for quick access
  // All checked locations (for debugging)
  checkedLocations: [{
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GeofenceLocation',
    },
    locationName: String,
    distance: Number,
    isWithin: Boolean,
  }],
  // Break timing info
  duringBreakTime: {
    type: Boolean,
    default: false,
  },
  breakTimingName: String,
  
  // Out of Premises Request
  outOfPremisesRequest: {
    reason: String,
    requestedAt: Date,
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
    reviewedAt: Date,
    reviewerComments: String,
  },
  
  // Department Head Info (for filtering)
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  },
  reportingManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  },
  
  // Additional Context
  duringWorkHours: {
    type: Boolean,
    default: false,
  },
  deviceInfo: {
    userAgent: String,
    platform: String,
    browser: String,
  },
  
  // Notification Status
  notificationSent: {
    type: Boolean,
    default: false,
  },
  notificationSentAt: Date,
  
}, {
  timestamps: true,
});

// Index for efficient queries
GeofenceLogSchema.index({ employee: 1, createdAt: -1 });
GeofenceLogSchema.index({ department: 1, createdAt: -1 });
GeofenceLogSchema.index({ reportingManager: 1, 'outOfPremisesRequest.status': 1 });
GeofenceLogSchema.index({ eventType: 1, isWithinGeofence: 1 });

export default mongoose.models.GeofenceLog || mongoose.model('GeofenceLog', GeofenceLogSchema);

