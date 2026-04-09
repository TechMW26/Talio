/**
 * Company Admin Management API
 * GET/POST/PATCH /api/superadmin/companies/[id]/admin
 * 
 * Allows superadmin to create, view, and update the admin user for a company
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import getTenantCompanyModel from '@/models/TenantCompany';
import getUserTenantMappingModel from '@/models/UserTenantMapping';
import { getTenantConnection } from '@/lib/tenantDb';
import { getTenantModels } from '@/lib/tenantModels';
import mongoose from 'mongoose';

// Employee schema for tenant database
const EmployeeSchema = new mongoose.Schema({
  employeeId: { type: String, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String },
  email: { type: String, required: true, lowercase: true },
  phone: String,
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  position: String,
  joiningDate: Date,
  status: { type: String, enum: ['active', 'inactive', 'terminated'], default: 'active' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// Company schema for tenant database
const CompanySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: String,
  email: String,
  phone: String,
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    postalCode: String,
  },
  settings: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

/**
 * GET - Get admin users for a company
 */
export async function GET(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
    }

    const { id } = await params;
    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findById(id).lean();

    if (!company) {
      return NextResponse.json({ success: false, message: 'Company not found' }, { status: 404 });
    }

    // Connect to tenant database
    const { User: UserModel } = await getTenantModels(company.databaseName, ['User']);

    // Get all admin users
    const admins = await UserModel.find({ role: 'admin' })
      .select('-password')
      .populate('employeeId')
      .lean();

    return NextResponse.json({
      success: true,
      admins: admins.map(admin => ({
        _id: admin._id,
        email: admin.email,
        role: admin.role,
        isActive: admin.isActive,
        forcePasswordChange: admin.forcePasswordChange,
        lastLogin: admin.lastLogin,
        createdAt: admin.createdAt,
        employee: admin.employeeId ? {
          firstName: admin.employeeId.firstName,
          lastName: admin.employeeId.lastName,
          employeeId: admin.employeeId.employeeId,
        } : null,
      })),
      companyName: company.name,
      databaseName: company.databaseName,
    });

  } catch (error) {
    console.error('[SuperAdmin Company Admin GET] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch admins', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST - Create a new admin user for a company
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { email, password, firstName, lastName, phone } = body;

    // Validate required fields
    if (!email || !password || !firstName) {
      return NextResponse.json(
        { success: false, message: 'Email, password, and first name are required' },
        { status: 400 }
      );
    }

    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findById(id);

    if (!company) {
      return NextResponse.json({ success: false, message: 'Company not found' }, { status: 404 });
    }

    // Connect to tenant database
    const tenantConnection = await getTenantConnection(company.databaseName);
    const { User: UserModel } = await getTenantModels(company.databaseName, ['User']);
    const EmployeeModel = tenantConnection.models.Employee || tenantConnection.model('Employee', EmployeeSchema);
    const CompanyModel = tenantConnection.models.Company || tenantConnection.model('Company', CompanySchema);

    // Check if email already exists
    const existingUser = await UserModel.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return NextResponse.json(
        { success: false, message: 'A user with this email already exists' },
        { status: 400 }
      );
    }

    // Create or get Company record in tenant DB
    let tenantCompany = await CompanyModel.findOne({});
    if (!tenantCompany) {
      tenantCompany = await CompanyModel.create({
        name: company.name,
        slug: company.slug,
        email: company.primaryContact?.email,
        phone: company.primaryContact?.phone,
      });
    }

    // Generate employee ID
    const employeeCount = await EmployeeModel.countDocuments({});
    const employeeIdNumber = String(employeeCount + 1).padStart(4, '0');
    const employeeIdPrefix = company.slug?.substring(0, 3).toUpperCase() || 'EMP';
    const newEmployeeId = `${employeeIdPrefix}${employeeIdNumber}`;

    // Create Employee record
    const employee = await EmployeeModel.create({
      employeeId: newEmployeeId,
      firstName,
      lastName: lastName || '',
      email: email.toLowerCase(),
      phone: phone || '',
      position: 'Administrator',
      joiningDate: new Date(),
      status: 'active',
      isActive: true,
    });

    // Create User record
    const user = await UserModel.create({
      email: email.toLowerCase(),
      password,
      role: 'admin',
      employeeId: employee._id,
      company: tenantCompany._id,
      isActive: true,
      forcePasswordChange: true, // Force password change on first login
    });

    // Create UserTenantMapping
    const UserTenantMapping = await getUserTenantMappingModel();
    await UserTenantMapping.findOneAndUpdate(
      { email: email.toLowerCase() },
      {
        email: email.toLowerCase(),
        tenantCompanyId: company._id,
        databaseName: company.databaseName,
        companySlug: company.slug,
        companyName: company.name,
        userId: user._id,
        role: 'admin',
        isActive: true,
      },
      { upsert: true, new: true }
    );

    // Mark company setup as complete
    if (!company.isSetupComplete) {
      company.isSetupComplete = true;
      company.setupCompletedAt = new Date();
      if (company.setupCode) {
        company.setupCode.isUsed = true;
        company.setupCode.usedAt = new Date();
        company.setupCode.usedByEmail = email.toLowerCase();
      }
      await company.save();
    }

    console.log(`✅ [SuperAdmin] Created admin user for ${company.name}: ${email}`);

    return NextResponse.json({
      success: true,
      message: 'Admin user created successfully',
      admin: {
        _id: user._id,
        email: user.email,
        role: user.role,
        employee: {
          firstName: employee.firstName,
          lastName: employee.lastName,
          employeeId: employee.employeeId,
        },
      },
    });

  } catch (error) {
    console.error('[SuperAdmin Company Admin POST] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to create admin', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update an admin user (reset password, toggle active, etc.)
 */
export async function PATCH(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { userId, email, password, isActive, forcePasswordChange } = body;

    if (!userId && !email) {
      return NextResponse.json(
        { success: false, message: 'Either userId or email is required' },
        { status: 400 }
      );
    }

    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findById(id).lean();

    if (!company) {
      return NextResponse.json({ success: false, message: 'Company not found' }, { status: 404 });
    }

    // Connect to tenant database
    const { User: UserModel } = await getTenantModels(company.databaseName, ['User']);

    // Find the user
    const query = userId ? { _id: userId } : { email: email.toLowerCase() };
    const user = await UserModel.findOne(query).select('+password');

    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    const appliedUpdates = [];

    if (password) {
      user.password = password;
      user.forcePasswordChange = true; // Force password change after reset
      appliedUpdates.push('forcePasswordChange');
      console.log(`🔐 [SuperAdmin] Password reset for ${user.email} in ${company.name}`);
    }

    if (typeof isActive === 'boolean') {
      user.isActive = isActive;
      appliedUpdates.push('isActive');

      // Update UserTenantMapping as well
      const UserTenantMapping = await getUserTenantMappingModel();
      await UserTenantMapping.updateOne(
        { email: user.email },
        { isActive }
      );
    }

    if (typeof forcePasswordChange === 'boolean') {
      user.forcePasswordChange = forcePasswordChange;
      if (!appliedUpdates.includes('forcePasswordChange')) {
        appliedUpdates.push('forcePasswordChange');
      }
    }

    if (appliedUpdates.length === 0) {
      return NextResponse.json({ success: false, message: 'No updates provided' }, { status: 400 });
    }

    await user.save({ validateBeforeSave: false });

    return NextResponse.json({
      success: true,
      message: 'Admin user updated successfully',
      updates: appliedUpdates,
    });

  } catch (error) {
    console.error('[SuperAdmin Company Admin PATCH] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update admin', error: error.message },
      { status: 500 }
    );
  }
}
