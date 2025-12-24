/**
 * SuperAdmin Middleware Helper
 * 
 * Verifies superadmin authentication for protected routes
 */

import { jwtVerify } from 'jose';
import getSuperAdminModel from '@/models/SuperAdmin';

/**
 * Verify superadmin token from request
 * @param {Request} request - Next.js request object
 * @returns {Object} - { success, superadmin?, message? }
 */
export async function verifySuperAdmin(request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return { success: false, message: 'No token provided' };
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    if (!payload.isSuperAdmin) {
      return { success: false, message: 'Not a superadmin token' };
    }

    const SuperAdmin = await getSuperAdminModel();
    const superadmin = await SuperAdmin.findById(payload.superadminId);

    if (!superadmin || !superadmin.isActive) {
      return { success: false, message: 'Superadmin not found or inactive' };
    }

    return {
      success: true,
      superadmin: {
        _id: superadmin._id,
        id: superadmin._id.toString(),
        email: superadmin.email,
        name: superadmin.name,
        permissions: superadmin.permissions,
      },
    };

  } catch (error) {
    console.error('[SuperAdmin Auth] Error:', error.message);
    return { success: false, message: 'Authentication failed' };
  }
}

export default verifySuperAdmin;
