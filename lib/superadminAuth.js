/**
 * SuperAdmin Middleware Helper
 * 
 * Verifies superadmin authentication for protected routes
 */

import { jwtVerify } from 'jose';
import { getSuperadminStore } from '@/lib/platform/firestoreSuperadmin.server';

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

    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });

    if (!payload.isSuperAdmin) {
      return { success: false, message: 'Not a superadmin token' };
    }

    const database = await getSuperadminStore();
    const superadmin = await database.get('superadmins', String(payload.superadminId));

    if (!superadmin || !superadmin.isActive || (Number(superadmin.authVersion) || 0) !== (Number(payload.authVersion) || 0)) {
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
        lastLogin: superadmin.lastLogin,
      },
    };

  } catch (error) {
    console.error('[SuperAdmin Auth] Error:', error.message);
    return { success: false, message: 'Authentication failed' };
  }
}

export default verifySuperAdmin;
