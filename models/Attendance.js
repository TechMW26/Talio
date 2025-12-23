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
}, {
  timestamps: true,
});

// Compound index for employee and date
AttendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
// Additional indexes for common queries
AttendanceSchema.index({ date: 1, status: 1 }); // Date-based reports
AttendanceSchema.index({ employee: 1, date: -1 }); // Employee attendance history

export default mongoose.models.Attendance || mongoose.model('Attendance', AttendanceSchema);

