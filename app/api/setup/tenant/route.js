/**
 * Tenant Setup API
 * 
 * GET /api/setup/tenant?code=xxx - Validate setup code
 * POST /api/setup/tenant - Create admin for a new tenant using setup code
 */

import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { validateSetupCode, markSetupCodeUsed, registerUserTenantMapping } from '@/lib/tenantContext';
import { getTenantConnection } from '@/lib/tenantDb';
import { getTenantModels } from '@/lib/tenantModels';
import mongoose from 'mongoose';

// Employee schema for tenant database
const EmployeeSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  employeeCode: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  dateOfJoining: { type: Date, default: Date.now },
  phone: String,
}, { timestamps: true, strict: false });

/**
 * GET - Validate setup code
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');

    if (!code) {
      return NextResponse.json(
        { success: false, message: 'Setup code is required' },
        { status: 400 }
      );
    }

    const result = await validateSetupCode(code);

    if (!result.valid) {
      return NextResponse.json(
        { success: false, message: result.reason },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      company: {
        name: result.company.name,
        slug: result.company.slug,
      },
    });

  } catch (error) {
    console.error('[Tenant Setup GET] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to validate setup code' },
      { status: 500 }
    );
  }
}

/**
 * POST - Create admin for new tenant
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { setupCode, email, password, firstName, lastName, organizationName } = body;

    // Validate required fields
    if (!setupCode || !email || !password || !firstName || !lastName) {
      return NextResponse.json(
        { success: false, message: 'All fields are required: setupCode, email, password, firstName, lastName' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, message: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Validate password strength
    if (password.length < 8) {
      return NextResponse.json(
        { success: false, message: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Validate setup code
    const setupResult = await validateSetupCode(setupCode);
    if (!setupResult.valid) {
      return NextResponse.json(
        { success: false, message: setupResult.reason },
        { status: 400 }
      );
    }

    const { company } = setupResult;
    console.log(`[Tenant Setup] Creating admin for company: ${company.name} (${company.databaseName})`);

    // Connect to the tenant's database
    const tenantConnection = await getTenantConnection(company.databaseName);

    // Get or create models on tenant connection
    const { User } = await getTenantModels(company.databaseName, ['User']);
    const Employee = tenantConnection.models.Employee || tenantConnection.model('Employee', EmployeeSchema);

    // Check if email already exists in tenant database
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return NextResponse.json(
        { success: false, message: 'A user with this email already exists' },
        { status: 400 }
      );
    }

    // Create employee record
    const employee = new Employee({
      firstName,
      lastName,
      email: email.toLowerCase(),
      employeeCode: 'ADMIN-001',
      isActive: true,
      dateOfJoining: new Date(),
      phone: '',
    });
    await employee.save();
    console.log(`[Tenant Setup] Created employee: ${employee._id}`);

    // Create admin user
    const user = new User({
      email: email.toLowerCase(),
      password,
      role: 'admin',
      employeeId: employee._id,
      isActive: true,
      forcePasswordChange: false, // Admin doesn't need to change password on first login
      lastLogin: new Date(),
    });
    await user.save();
    console.log(`[Tenant Setup] Created admin user: ${user._id}`);

    // Mark setup code as used
    await markSetupCodeUsed(company.id, email);

    // Register user in tenant mapping
    await registerUserTenantMapping({
      email: email.toLowerCase(),
      tenantCompanyId: company.id,
      databaseName: company.databaseName,
      companyName: company.name,
      companySlug: company.slug,
      role: 'admin',
    });

    // Create JWT token
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const token = await new SignJWT({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      companySlug: company.slug,
      databaseName: company.databaseName,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret);

    return NextResponse.json({
      success: true,
      message: 'Admin account created successfully',
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
        employeeId: {
          _id: employee._id.toString(),
          firstName,
          lastName,
          email: email.toLowerCase(),
          employeeCode: 'ADMIN-001',
        },
      },
      company: {
        name: company.name,
        slug: company.slug,
      },
    });

  } catch (error) {
    console.error('[Tenant Setup POST] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to create admin account', error: error.message },
      { status: 500 }
    );
  }
}
