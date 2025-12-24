/**
 * SuperAdmin Session Validation API
 * GET /api/superadmin/auth/session
 * 
 * Validates superadmin JWT token
 */

import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import getSuperAdminModel from '@/models/SuperAdmin';

export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'No token provided' },
        { status: 401 }
      );
    }

    // Verify token
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    if (!payload.isSuperAdmin) {
      return NextResponse.json(
        { success: false, message: 'Not a superadmin token' },
        { status: 401 }
      );
    }

    // Get SuperAdmin model and verify user still exists and is active
    const SuperAdmin = await getSuperAdminModel();
    const superadmin = await SuperAdmin.findById(payload.superadminId);

    if (!superadmin || !superadmin.isActive) {
      return NextResponse.json(
        { success: false, message: 'Superadmin not found or inactive' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      superadmin: {
        id: superadmin._id.toString(),
        email: superadmin.email,
        name: superadmin.name,
        permissions: superadmin.permissions,
        lastLogin: superadmin.lastLogin,
      },
    });

  } catch (error) {
    console.error('[SuperAdmin Session] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Invalid session' },
      { status: 401 }
    );
  }
}
