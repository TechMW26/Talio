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
    enum: ['early', 'on-time', 'late'],
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
      },
      capturedAt: Date, // Timestamp when location was captured
      accuracy: Number, // GPS accuracy in meters
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
      },
      capturedAt: Date, // Timestamp when location was captured
      accuracy: Number, // GPS accuracy in meters
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
    enum: ['user_checkin', 'manual_entry', 'system_auto_absent', 'system_backfill', 'correction', 'import'],
    default: 'user_checkin',
  },
  createdBySystem: {
    type: Boolean,
    default: false,
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

