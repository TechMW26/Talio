/**
 * User-Tenant Mapping Model
 * 
 * Maps user emails to their tenant company.
 * This allows detecting which company database a user belongs to during login.
 * Stored in the talio_superadmin database.
 */

import mongoose from 'mongoose';
import { connectSuperadminDB } from '@/lib/superadminDb';

const UserTenantMappingSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  tenantCompanyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TenantCompany',
    required: true,
  },
  databaseName: {
    type: String,
    required: true,
  },
  companyName: {
    type: String,
    required: true,
  },
  companySlug: {
    type: String,
    required: true,
  },
  // User's role within their company
  role: {
    type: String,
    default: 'employee',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  // For tracking
  lastLoginAt: Date,
  loginCount: { type: Number, default: 0 },
}, {
  timestamps: true,
});

// Indexes for fast lookup
UserTenantMappingSchema.index({ email: 1 });
UserTenantMappingSchema.index({ tenantCompanyId: 1 });
UserTenantMappingSchema.index({ databaseName: 1 });

let UserTenantMappingModel = null;

/**
 * Get the UserTenantMapping model connected to the superadmin database
 */
export async function getUserTenantMappingModel() {
  if (UserTenantMappingModel) {
    return UserTenantMappingModel;
  }
  
  const connection = await connectSuperadminDB();
  
  // Check if model already exists on this connection
  if (connection.models.UserTenantMapping) {
    UserTenantMappingModel = connection.models.UserTenantMapping;
  } else {
    UserTenantMappingModel = connection.model('UserTenantMapping', UserTenantMappingSchema);
  }
  
  return UserTenantMappingModel;
}

export { UserTenantMappingSchema };
export default getUserTenantMappingModel;
