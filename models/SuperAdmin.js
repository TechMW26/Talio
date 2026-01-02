/**
 * SuperAdmin Model
 * 
 * Platform administrators who can manage all tenant companies.
 * Stored in the talio_superadmin database, separate from company data.
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectSuperadminDB } from '@/lib/superadminDb';

const SuperAdminSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 6,
    select: false,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  lastLogin: {
    type: Date,
  },
  // Permissions for different superadmin levels
  permissions: {
    canCreateCompanies: { type: Boolean, default: true },
    canDeleteCompanies: { type: Boolean, default: true },
    canManageSubscriptions: { type: Boolean, default: true },
    canManageSuperadmins: { type: Boolean, default: false }, // Only root superadmin
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SuperAdmin',
  },
}, {
  timestamps: true,
});

// Hash password before saving
SuperAdminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
SuperAdminSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Static method to get the model with superadmin DB connection
SuperAdminSchema.statics.getModel = async function () {
  const connection = await connectSuperadminDB();
  return connection.model('SuperAdmin', SuperAdminSchema);
};

// We need to get the model from the superadmin connection
let SuperAdminModel = null;
let lastConnection = null;

/**
 * Get the SuperAdmin model connected to the superadmin database
 */
export async function getSuperAdminModel() {
  const connection = await connectSuperadminDB();
  
  // Check if we need to refresh the model (connection changed or stale)
  if (SuperAdminModel && lastConnection === connection && connection.readyState === 1) {
    return SuperAdminModel;
  }
  
  // Check if model already exists on this connection
  if (connection.models.SuperAdmin) {
    SuperAdminModel = connection.models.SuperAdmin;
  } else {
    SuperAdminModel = connection.model('SuperAdmin', SuperAdminSchema);
  }
  
  lastConnection = connection;
  return SuperAdminModel;
}

export { SuperAdminSchema };
export default getSuperAdminModel;
