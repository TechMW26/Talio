/**
 * Tenant Context Helper
 * 
 * This module provides utilities for working with multi-tenant database connections.
 * It handles looking up which database a user belongs to and connecting to the right DB.
 */

import getUserTenantMappingModel from '@/models/UserTenantMapping';
import getTenantCompanyModel from '@/models/TenantCompany';
import { getTenantConnection } from './tenantDb';
import { connectSuperadminDB } from './superadminDb';

// Cache for tenant info lookups (email -> tenant info)
const tenantCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Look up which tenant a user belongs to based on their email
 * @param {string} email - User's email address
 * @returns {Promise<Object|null>} - Tenant info { databaseName, companyName, companySlug, tenantCompanyId } or null
 */
export async function getTenantByEmail(email) {
  if (!email) return null;
  
  const normalizedEmail = email.toLowerCase().trim();
  
  // Check cache first
  const cached = tenantCache.get(normalizedEmail);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  try {
    // Ensure superadmin connection
    await connectSuperadminDB();
    
    const UserTenantMapping = await getUserTenantMappingModel();
    const mapping = await UserTenantMapping.findOne({ 
      email: normalizedEmail,
      isActive: true 
    }).lean();
    
    if (mapping) {
      const tenantInfo = {
        databaseName: mapping.databaseName,
        companyName: mapping.companyName,
        companySlug: mapping.companySlug,
        tenantCompanyId: mapping.tenantCompanyId,
        role: mapping.role,
      };
      
      // Update cache
      tenantCache.set(normalizedEmail, {
        data: tenantInfo,
        timestamp: Date.now(),
      });
      
      return tenantInfo;
    }
    
    // Cache negative result too
    tenantCache.set(normalizedEmail, {
      data: null,
      timestamp: Date.now(),
    });
    
    return null;
  } catch (error) {
    console.error('[TenantContext] Error looking up tenant for email:', error.message);
    return null;
  }
}

/**
 * Get tenant info by company slug
 * @param {string} slug - Company slug
 * @returns {Promise<Object|null>} - Tenant company info or null
 */
export async function getTenantBySlug(slug) {
  if (!slug) return null;
  
  try {
    await connectSuperadminDB();
    
    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findOne({ 
      slug: slug.toLowerCase(),
      isActive: true 
    }).lean();
    
    if (company) {
      return {
        id: company._id,
        name: company.name,
        slug: company.slug,
        databaseName: company.databaseName,
        serviceStatus: company.serviceStatus,
        isSetupComplete: company.isSetupComplete,
        subscription: company.subscription,
      };
    }
    
    return null;
  } catch (error) {
    console.error('[TenantContext] Error looking up tenant by slug:', error.message);
    return null;
  }
}

/**
 * Validate setup code and get tenant info
 * @param {string} setupCode - The setup code from URL
 * @returns {Promise<Object|null>} - Tenant info or null if invalid/expired
 */
export async function validateSetupCode(setupCode) {
  if (!setupCode) return null;
  
  try {
    await connectSuperadminDB();
    
    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findOne({
      'setupCode.code': setupCode,
      'setupCode.isUsed': false,
      isActive: true,
    }).lean();
    
    if (!company) {
      return { valid: false, reason: 'Invalid or already used setup code' };
    }
    
    // Check expiration
    if (new Date(company.setupCode.expiresAt) < new Date()) {
      return { valid: false, reason: 'Setup code has expired' };
    }
    
    return {
      valid: true,
      company: {
        id: company._id,
        name: company.name,
        slug: company.slug,
        databaseName: company.databaseName,
        primaryContact: company.primaryContact,
      },
    };
  } catch (error) {
    console.error('[TenantContext] Error validating setup code:', error.message);
    return { valid: false, reason: 'Error validating setup code' };
  }
}

/**
 * Mark a setup code as used after successful admin creation
 * @param {string} companyId - The tenant company ID
 * @param {string} email - Email of the admin who used the code
 */
export async function markSetupCodeUsed(companyId, email) {
  try {
    await connectSuperadminDB();
    
    const TenantCompany = await getTenantCompanyModel();
    await TenantCompany.updateOne(
      { _id: companyId },
      {
        $set: {
          'setupCode.isUsed': true,
          'setupCode.usedAt': new Date(),
          'setupCode.usedByEmail': email,
          isSetupComplete: true,
          setupCompletedAt: new Date(),
        },
      }
    );
    
    console.log(`[TenantContext] Setup code marked as used for company ${companyId}`);
  } catch (error) {
    console.error('[TenantContext] Error marking setup code used:', error.message);
  }
}

/**
 * Register a user in the tenant mapping
 * @param {Object} params - User registration params
 */
export async function registerUserTenantMapping({
  email,
  tenantCompanyId,
  databaseName,
  companyName,
  companySlug,
  role = 'employee',
}) {
  try {
    await connectSuperadminDB();
    
    const UserTenantMapping = await getUserTenantMappingModel();
    
    // Upsert the mapping
    await UserTenantMapping.findOneAndUpdate(
      { email: email.toLowerCase() },
      {
        email: email.toLowerCase(),
        tenantCompanyId,
        databaseName,
        companyName,
        companySlug,
        role,
        isActive: true,
      },
      { upsert: true, new: true }
    );
    
    // Clear cache for this email
    tenantCache.delete(email.toLowerCase());
    
    console.log(`[TenantContext] User ${email} registered for tenant ${companySlug}`);
  } catch (error) {
    console.error('[TenantContext] Error registering user tenant mapping:', error.message);
    throw error;
  }
}

/**
 * Update login stats for a user's tenant mapping
 * @param {string} email - User's email
 */
export async function updateUserLoginStats(email) {
  try {
    await connectSuperadminDB();
    
    const UserTenantMapping = await getUserTenantMappingModel();
    await UserTenantMapping.updateOne(
      { email: email.toLowerCase() },
      {
        $set: { lastLoginAt: new Date() },
        $inc: { loginCount: 1 },
      }
    );
  } catch (error) {
    // Non-critical, log and continue
    console.warn('[TenantContext] Error updating login stats:', error.message);
  }
}

/**
 * Check if a company's service is active
 * @param {string} databaseName - The database name of the tenant
 * @returns {Promise<{active: boolean, reason?: string}>}
 */
export async function checkServiceStatus(databaseName) {
  try {
    await connectSuperadminDB();
    
    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findOne({ databaseName }).lean();
    
    if (!company) {
      return { active: false, reason: 'Company not found' };
    }
    
    if (!company.isActive) {
      return { active: false, reason: 'Company account is deactivated' };
    }
    
    if (company.serviceStatus === 'suspended') {
      return { active: false, reason: company.servicePausedReason || 'Service suspended' };
    }
    
    if (company.serviceStatus === 'paused') {
      return { active: false, reason: company.servicePausedReason || 'Service paused' };
    }
    
    if (company.serviceStatus === 'terminated') {
      return { active: false, reason: 'Company account terminated' };
    }
    
    return { active: true };
  } catch (error) {
    console.error('[TenantContext] Error checking service status:', error.message);
    return { active: true }; // Default to active on error to not block legitimate users
  }
}

/**
 * Check if a company has reached its user limit
 * @param {string} databaseName - The database name of the tenant
 * @returns {Promise<{allowed: boolean, currentCount: number, maxUsers: number, message?: string}>}
 */
export async function checkUserLimit(databaseName) {
  try {
    await connectSuperadminDB();
    
    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findOne({ databaseName }).lean();
    
    if (!company) {
      return { allowed: false, message: 'Company not found', currentCount: 0, maxUsers: 0 };
    }
    
    // Get current user count from tenant database
    const tenantConnection = await getTenantConnection(databaseName);
    const mongoose = await import('mongoose');
    const UserModel = tenantConnection.model('User', new mongoose.Schema({}, { strict: false }), 'users');
    const currentCount = await UserModel.countDocuments({ isActive: true });
    
    const maxUsers = company.subscription?.maxUsers || 10;
    
    // Update the current user count in the company record
    await TenantCompany.updateOne(
      { databaseName },
      { $set: { 'subscription.currentUserCount': currentCount } }
    );
    
    if (currentCount >= maxUsers) {
      // Mark that user limit was reached
      await TenantCompany.updateOne(
        { databaseName },
        { 
          $set: { 
            'analytics.userLimitReachedAt': new Date(),
            'subscription.currentUserCount': currentCount 
          } 
        }
      );
      
      return { 
        allowed: false, 
        currentCount, 
        maxUsers, 
        message: `User limit reached. Maximum ${maxUsers} users allowed. Please contact Talio support to increase your limit.` 
      };
    }
    
    return { allowed: true, currentCount, maxUsers };
  } catch (error) {
    console.error('[TenantContext] Error checking user limit:', error.message);
    // Default to allowed on error to not block legitimate operations
    return { allowed: true, currentCount: 0, maxUsers: 999, message: 'Error checking limit' };
  }
}

/**
 * Get tenant company info from database name
 * @param {string} databaseName - The database name
 * @returns {Promise<Object|null>} - Company info or null
 */
export async function getTenantCompanyByDbName(databaseName) {
  if (!databaseName) return null;
  
  try {
    await connectSuperadminDB();
    
    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findOne({ databaseName }).lean();
    
    return company;
  } catch (error) {
    console.error('[TenantContext] Error getting tenant company:', error.message);
    return null;
  }
}

/**
 * Clear the tenant cache (useful after admin updates)
 * @param {string} email - Optional specific email to clear, or all if not provided
 */
export function clearTenantCache(email = null) {
  if (email) {
    tenantCache.delete(email.toLowerCase());
  } else {
    tenantCache.clear();
  }
}

export default {
  getTenantByEmail,
  getTenantBySlug,
  validateSetupCode,
  markSetupCodeUsed,
  registerUserTenantMapping,
  updateUserLoginStats,
  checkServiceStatus,
  checkUserLimit,
  getTenantCompanyByDbName,
  clearTenantCache,
};
