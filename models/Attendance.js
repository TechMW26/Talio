import mongoose from 'mongoose';

const AttendanceSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  checkIn: {
    type: Date,
  },
  checkOut: {
    type: Date,
  },
  checkInStatus: {
    type: String,
    enum: ['early', 'on-time', 'late'],
    default: 'on-time',
  },
  checkOutStatus: {
    type: String,
    enum: ['early', 'on-time', 'late', 'auto-checkout'],
    default: 'on-time',
  },
  status: {
    type: String,
    enum: ['present', 'absent', 'half-day', 'late', 'on-leave', 'holiday', 'weekend', 'in-progress'],
    default: 'absent',
  },
  workFromHome: {
    type: Boolean,
    default: false,
  },
  workHours: {
    type: Number,
    default: 0,
  },
  totalLoggedHours: {
    type: Number,
    default: 0,
  },
  breakMinutes: {
    type: Number,
    default: 0,
  },
  shrinkagePercentage: {
    type: Number,
    default: 0,
  },
  statusReason: {
    type: String,
  },
  overtime: {
    type: Number,
    default: 0,
  },
  shift: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shift',
  },
  location: {
    checkIn: {
      latitude: Number,
      longitude: Number,
      address: String,
      addressDetails: {
        city: String,
        state: String,
        country: String,
        pincode: String,
        fullAddress: String,
        // Enhanced Google Maps fields
        houseNumber: String,     // Street number (e.g., "123")
        building: String,        // Building/premise name (e.g., "ABC Apartments")
        unit: String,           // Unit/flat number (e.g., "Flat 302")
        road: String,           // Street/road name (e.g., "MG Road")
        neighborhood: String,    // Neighborhood/area (e.g., "Connaught Place")
        source: String,         // 'google_maps', 'openstreetmap', 'coordinates_only'
      },
      capturedAt: Date, // Timestamp when location was captured
      accuracy: Number, // GPS accuracy in meters
      source: String,
      warning: String, // Warning message if location not captured
      geofenceLocation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GeofenceLocation',
      },
      geofenceLocationName: String, // Cached for quick access
    },
    checkOut: {
      latitude: Number,
      longitude: Number,
      address: String,
      addressDetails: {
        city: String,
        state: String,
        country: String,
        pincode: String,
        fullAddress: String,
        // Enhanced Google Maps fields
        houseNumber: String,     // Street number (e.g., "123")
        building: String,        // Building/premise name (e.g., "ABC Apartments")
        unit: String,           // Unit/flat number (e.g., "Flat 302")
        road: String,           // Street/road name (e.g., "MG Road")
        neighborhood: String,    // Neighborhood/area (e.g., "Connaught Place")
        source: String,         // 'google_maps', 'openstreetmap', 'coordinates_only'
      },
      capturedAt: Date, // Timestamp when location was captured
      accuracy: Number, // GPS accuracy in meters
      source: String,
      warning: String, // Warning message if location not captured
      geofenceLocation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GeofenceLocation',
      },
      geofenceLocationName: String, // Cached for quick access
    },
  },
  // Geofence validation
  geofenceValidated: {
    type: Boolean,
    default: false,
  },
  geofenceOverride: {
    approved: Boolean,
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
    approvedAt: Date,
    reason: String,
  },
  // Location warning - populated when GPS location was not captured
  locationWarning: {
    type: String,
  },
  remarks: {
    type: String,
  },
  isManualEntry: {
    type: Boolean,
    default: false,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  },
  // Audit fields for tracking system-generated records
  source: {
    type: String,
    enum: ['manual', 'user_checkin', 'manual_entry', 'geofence', 'system', 'system_auto_absent', 'system_backfill', 'correction', 'import', 'auto_checkout', 'attendance_machine'],
    default: 'user_checkin',
  },
  createdBySystem: {
    type: Boolean,
    default: false,
  },
  // Auto-checkout tracking
  autoCheckedOut: {
    type: Boolean,
    default: false,
  },
  autoCheckoutReason: {
    type: String,
    enum: ['midnight_cutoff', 'geofence_exit', 'overtime_timeout', null],
    default: null,
  },
  autoCheckoutAt: {
    type: Date,
  },
  // For tracking who made manual entries
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

// Compound index for employee and date
AttendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
// Additional indexes for common queries
AttendanceSchema.index({ date: 1, status: 1 }); // Date-based reports
AttendanceSchema.index({ employee: 1, date: -1 }); // Employee attendance history
AttendanceSchema.index({ source: 1, createdBySystem: 1 }); // Audit queries for system-generated records
AttendanceSchema.index({ date: 1, source: 1 }); // Date-based audit queries

export default mongoose.models.Attendance || mongoose.model('Attendance', AttendanceSchema);

