/**
 * SuperAdmin Login API
 * POST /api/superadmin/auth/login
 * 
 * Handles superadmin authentication
 */

import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import getSuperAdminModel from '@/models/SuperAdmin';

export async function POST(request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Get SuperAdmin model
    const SuperAdmin = await getSuperAdminModel();

    // Find superadmin by email
    const superadmin = await SuperAdmin.findOne({ email: email.toLowerCase() }).select('+password');

    if (!superadmin) {
      return NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      );
    }

    if (!superadmin.isActive) {
      return NextResponse.json(
        { success: false, message: 'Account is deactivated' },
        { status: 401 }
      );
    }

    // Verify password
    const isPasswordMatch = await superadmin.comparePassword(password);

    if (!isPasswordMatch) {
      return NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // Update last login
    superadmin.lastLogin = new Date();
    await superadmin.save({ validateBeforeSave: false });

    // Create JWT token with superadmin flag
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const token = await new SignJWT({
      superadminId: superadmin._id.toString(),
      email: superadmin.email,
      name: superadmin.name,
      isSuperAdmin: true,
      permissions: superadmin.permissions,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(secret);

    return NextResponse.json({
      success: true,
      message: 'Login successful',
      token,
      superadmin: {
        id: superadmin._id.toString(),
        email: superadmin.email,
        name: superadmin.name,
        permissions: superadmin.permissions,
        lastLogin: superadmin.lastLogin,
      },
    });

  } catch (error) {
    console.error('[SuperAdmin Login] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Login failed', error: error.message },
      { status: 500 }
    );
  }
}
