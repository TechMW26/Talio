/**
 * Tenant-Aware Database Connection Helper
 * 
 * This module provides a drop-in replacement for connectDB that automatically
 * connects to the correct tenant database based on the JWT token in the request.
 * 
 * Usage in API routes:
 * 
 * ```javascript
 * import { connectTenantDB, getTenantModelsFromRequest } from '@/lib/tenantAuth'
 * 
 * export async function GET(request) {
 *   const { User, Employee, ... } = await getTenantModelsFromRequest(request);
 *   // Now use these models - they're bound to the correct tenant database
 * }
 * ```
 */

import { verifyToken } from './auth';
import { getTenantModel, getTenantModels } from './tenantModels';
import connectDB from './mongodb';

// Import default models for fallback
import User from '@/models/User';
import Employee from '@/models/Employee';
import Department from '@/models/Department';
import Designation from '@/models/Designation';
import Attendance from '@/models/Attendance';
import Leave from '@/models/Leave';

// Default models map (when no tenant context)
const DEFAULT_MODELS = {
  User,
  Employee,
  Department,
  Designation,
  Attendance,
  Leave,
};

/**
 * Extract tenant database name from request JWT
 * @param {Request} request - Next.js request object
 * @returns {Promise<string|null>} - Database name or null for default
 */
export async function extractTenantFromRequest(request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '') || request.cookies?.get('token')?.value;

  if (!token) return null;

  const payload = await verifyToken(token);
  return payload?.databaseName || null;
}

/**
 * Connect to the appropriate tenant database based on request JWT
 * This is a drop-in replacement for connectDB that's tenant-aware
 * 
 * @param {Request} request - Next.js request object
 * @returns {Promise<{databaseName: string|null, isTenant: boolean}>}
 */
export async function connectTenantDB(request) {
  const databaseName = await extractTenantFromRequest(request);
  
  if (databaseName) {
    // Tenant connection is established when getting models
    // Just return the info
    return { databaseName, isTenant: true };
  }
  
  // Fall back to default database
  await connectDB();
  return { databaseName: null, isTenant: false };
}

/**
 * Get models bound to the correct tenant database based on request JWT
 * This is the primary function API routes should use
 * 
 * @param {Request} request - Next.js request object
 * @param {string[]} modelNames - Array of model names to get (defaults to common ones)
 * @returns {Promise<Object>} - Object with model names as keys
 * 
 * @example
 * const { User, Employee, Attendance } = await getTenantModelsFromRequest(request);
 * const users = await User.find({});
 */
export async function getTenantModelsFromRequest(request, modelNames = ['User', 'Employee', 'Department']) {
  const databaseName = await extractTenantFromRequest(request);
  
  if (databaseName) {
    console.log(`[TenantAuth] Using tenant database: ${databaseName}`);
    return await getTenantModels(databaseName, modelNames);
  }
  
  // Fall back to default database
  console.log('[TenantAuth] Using default database (no tenant context)');
  await connectDB();
  
  // Return default models (filtered by requested names)
  const result = {};
  for (const name of modelNames) {
    if (DEFAULT_MODELS[name]) {
      result[name] = DEFAULT_MODELS[name];
    } else {
      // For models not in DEFAULT_MODELS, try importing dynamically
      // This is a fallback - in practice, frequently used models should be added above
      console.warn(`[TenantAuth] Model ${name} not in DEFAULT_MODELS, using default connection`);
      try {
        const modelModule = await import(`@/models/${name}`);
        result[name] = modelModule.default;
      } catch (err) {
        console.error(`[TenantAuth] Could not load model ${name}:`, err.message);
      }
    }
  }
  
  return result;
}

/**
 * Get a single model bound to the correct tenant database
 * 
 * @param {Request} request - Next.js request object
 * @param {string} modelName - Name of the model to get
 * @returns {Promise<mongoose.Model>}
 */
export async function getTenantModelFromRequest(request, modelName) {
  const databaseName = await extractTenantFromRequest(request);
  
  if (databaseName) {
    return await getTenantModel(databaseName, modelName);
  }
  
  // Fall back to default database
  await connectDB();
  
  if (DEFAULT_MODELS[modelName]) {
    return DEFAULT_MODELS[modelName];
  }
  
  // Try dynamic import
  const modelModule = await import(`@/models/${modelName}`);
  return modelModule.default;
}

/**
 * Verify request and get tenant-bound models in one call
 * Combines authentication check with tenant model retrieval
 * 
 * @param {Request} request - Next.js request object
 * @param {string[]} modelNames - Models to retrieve
 * @returns {Promise<{success: boolean, user?: Object, models?: Object, error?: string}>}
 */
export async function verifyAndGetTenantModels(request, modelNames = ['User', 'Employee']) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '') || request.cookies?.get('token')?.value;

    if (!token) {
      return { success: false, error: 'No authentication token provided' };
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return { success: false, error: 'Invalid or expired token' };
    }

    const databaseName = payload.databaseName || null;
    let models;
    let UserModel;

    if (databaseName) {
      models = await getTenantModels(databaseName, modelNames);
      UserModel = models.User || await getTenantModel(databaseName, 'User');
    } else {
      await connectDB();
      models = {};
      for (const name of modelNames) {
        models[name] = DEFAULT_MODELS[name] || (await import(`@/models/${name}`)).default;
      }
      UserModel = User;
    }

    // Fetch user from correct database
    const user = await UserModel.findById(payload.userId).select('-password');
    
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    if (!user.isActive) {
      return { success: false, error: 'User account is deactivated' };
    }

    return {
      success: true,
      user: {
        _id: user._id,
        id: user._id,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId,
        ...payload,
      },
      models,
      tenant: databaseName ? {
        databaseName,
        companySlug: payload.companySlug,
        companyName: payload.companyName,
      } : null,
    };
  } catch (error) {
    console.error('[TenantAuth] verifyAndGetTenantModels error:', error);
    return { success: false, error: 'Authentication failed' };
  }
}

export default {
  extractTenantFromRequest,
  connectTenantDB,
  getTenantModelsFromRequest,
  getTenantModelFromRequest,
  verifyAndGetTenantModels,
};
