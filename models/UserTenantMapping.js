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
// Note: email already has unique: true in schema, which auto-creates an index
UserTenantMappingSchema.index({ tenantCompanyId: 1 });
UserTenantMappingSchema.index({ databaseName: 1 });

let UserTenantMappingModel = null;
let lastConnection = null;

/**
 * Get the UserTenantMapping model connected to the superadmin database
 */
export async function getUserTenantMappingModel() {
  const connection = await connectSuperadminDB();
  
  // Check if we need to refresh the model (connection changed or stale)
  if (UserTenantMappingModel && lastConnection === connection && connection.readyState === 1) {
    return UserTenantMappingModel;
  }
  
  // Check if model already exists on this connection
  if (connection.models.UserTenantMapping) {
    UserTenantMappingModel = connection.models.UserTenantMapping;
  } else {
    UserTenantMappingModel = connection.model('UserTenantMapping', UserTenantMappingSchema);
  }
  
  lastConnection = connection;
  return UserTenantMappingModel;
}

export { UserTenantMappingSchema };
export default getUserTenantMappingModel;
