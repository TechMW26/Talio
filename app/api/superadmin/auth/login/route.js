/**
 * SuperAdmin Login API
 * POST /api/superadmin/auth/login
 * 
 * Handles superadmin authentication
 */

import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { getSuperadminStore } from '@/lib/platform/firestoreSuperadmin.server';
import { compareStoredPassword } from '@/lib/passwordAuth';

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
    const database = await getSuperadminStore();

    // Find superadmin by email
    const { records } = await database.list('superadmins', { filters: [{ field: 'email', operator: '==', value: email.toLowerCase().trim() }], limit: 2 });
    let superadmin = records.length === 1 ? records[0] : null;

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
    const isPasswordMatch = await compareStoredPassword(password, superadmin.password);

    if (!isPasswordMatch) {
      return NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // Update last login
    superadmin = await database.mutate('superadmins', superadmin._id, async current => {
      if (!current.isActive || !await compareStoredPassword(password, current.password)) throw new Error('Credentials changed');
      return { ...current, lastLogin: new Date(), updatedAt: new Date() };
    });

    // Create JWT token with superadmin flag
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const token = await new SignJWT({
      superadminId: superadmin._id.toString(),
      email: superadmin.email,
      name: superadmin.name,
      isSuperAdmin: true,
      authVersion: Number(superadmin.authVersion) || 0,
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
