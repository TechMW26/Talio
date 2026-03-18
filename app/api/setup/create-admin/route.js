import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Employee from '@/models/Employee';
import { syncUserToBackup } from '@/lib/backupDb';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

/**
 * POST /api/setup/create-admin
 * Create the first admin account during initial setup
 * This endpoint only works when no admin users exist in the database
 */
export async function POST(request) {
  try {
    // Basic logging to aid debugging when client sees empty responses
    console.log('[Setup] POST /api/setup/create-admin invoked');
    console.log('[Setup] NODE_ENV:', process.env.NODE_ENV ? process.env.NODE_ENV : 'undefined');
    console.log('[Setup] JWT_SECRET present:', !!process.env.JWT_SECRET);

    await connectDB();

    // CRITICAL: Verify no admin users exist
    const adminCount = await User.countDocuments({
      role: { $in: ['admin'] },
      isActive: true
    });

    if (adminCount > 0) {
      console.log('[Setup] Attempt to create admin when admin already exists');
      return NextResponse.json(
        { success: false, message: 'System is already configured. Admin account exists.' },
        { status: 403 }
      );
    }

    // Parse request body
    let body = {};
    try {
      body = await request.json();
      console.log('[Setup] Request body:', { ...body, password: body.password ? '<<redacted>>' : undefined });
    } catch (err) {
      console.error('[Setup] Failed to parse request body:', err);
      return NextResponse.json({ success: false, message: 'Invalid JSON body' }, { status: 400 });
    }
    const { email, password, firstName, lastName, organizationName } = body;

    // Validate required fields
    if (!email || !password || !firstName || !lastName) {
      return NextResponse.json(
        { success: false, message: 'Email, password, first name, and last name are required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, message: 'Please provide a valid email address' },
        { status: 400 }
      );
    }

    // Validate password strength
    if (password.length < 8) {
      return NextResponse.json(
        { success: false, message: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return NextResponse.json(
        { success: false, message: 'An account with this email already exists' },
        { status: 400 }
      );
    }

    // Create employee record first
    const employee = new Employee({
      firstName,
      lastName,
      email: email.toLowerCase(),
      employeeCode: 'ADMIN-001',
      isActive: true,
      dateOfJoining: new Date(),
      phone: '0000000000', // Placeholder phone for admin
    });

    await employee.save();
    console.log('[Setup] Created employee record:', employee._id);

    // Create admin user (password will be hashed by User model pre-save hook)
    const user = new User({
      email: email.toLowerCase(),
      password: password, // Plain password - will be hashed by pre-save hook
      role: 'admin', // First admin gets admin role
      employeeId: employee._id,
      isActive: true,
      forcePasswordChange: false, // Don't force password change for initial setup
      profileCompletion: {
        status: 'complete',
        firstLoginAt: new Date(),
        completedAt: new Date(),
        completedFields: {
          personalInfo: true,
          aadhaarUploaded: false, // Not required for admin
          ocrVerified: false,
        },
      },
      lastLogin: new Date(),
    });

    await user.save();
    console.log('[Setup] Created admin user:', user._id);

    // Sync to backup database (fire-and-forget)
    syncUserToBackup({
      originalUserId: user._id.toString(),
      email: user.email,
      password: user.password, // Use the hashed password from saved user
      role: user.role,
      employeeId: employee._id.toString(),
      isActive: user.isActive,
    });

    // Update employee with user reference
    employee.userId = user._id;
    await employee.save();

    // Generate JWT token
    let token = null;
    try {
      if (!process.env.JWT_SECRET) {
        console.warn('[Setup] JWT_SECRET not set; skipping token generation');
      } else {
        token = await new SignJWT({
          userId: user._id.toString(),
          email: user.email,
          role: user.role,
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt()
          .setExpirationTime('7d')
          .sign(JWT_SECRET);
      }
    } catch (err) {
      console.error('[Setup] Failed generating JWT:', err);
      // proceed without failing - return user created but no token
    }

    console.log('[Setup] Initial admin account created successfully:', email);

    // Prepare user data for frontend
    const userData = {
      userId: user._id.toString(),
      _id: user._id.toString(),
      email: user.email,
      role: user.role,
      firstName: employee.firstName,
      lastName: employee.lastName,
      employeeId: employee._id.toString(),
      employeeCode: employee.employeeCode,
    };

    // Create response with cookies
    const response = NextResponse.json({
      success: true,
      message: 'Admin account created successfully',
      data: {
        token,
        user: userData,
      },
    });

    // Set token cookie if token generated
    if (token) {
      response.cookies.set('token', token, {
        httpOnly: false, // Needs to be accessible by client
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60, // 7 days
        path: '/',
      });
    }

    // Set user cookie
    response.cookies.set('user', encodeURIComponent(JSON.stringify(userData)), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });

    return response;

  } catch (error) {
    console.error('[Setup] Error creating admin:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to create admin account', error: error.message },
      { status: 500 }
    );
  }
}
