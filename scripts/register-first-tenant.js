/**
 * Register First Tenant (Mushroom World Group)
 * 
 * This script registers the existing hrms_db as mushroom_world_group tenant
 * and creates user mappings for all existing users.
 * 
 * Run: node scripts/register-first-tenant.js
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config();

// Get the cluster URI without a specific database
const MONGODB_URI = process.env.MONGODB_URI;

function getClusterBaseUri() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not defined');
  }
  
  const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/);
  
  if (!match) {
    throw new Error('Invalid MONGODB_URI format');
  }
  
  return {
    baseUri: match[1],
    options: match[3] || ''
  };
}

function getDatabaseUri(databaseName) {
  const { baseUri, options } = getClusterBaseUri();
  return `${baseUri}/${databaseName}${options}`;
}

// TenantCompany Schema
const TenantCompanySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: { type: String, trim: true },
  logo: { type: String },
  databaseName: { type: String, required: true, unique: true },
  primaryContact: {
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    phone: { type: String },
  },
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    postalCode: String,
  },
  setupCode: {
    code: { type: String, unique: true, sparse: true },
    createdAt: Date,
    expiresAt: Date,
    isUsed: { type: Boolean, default: false },
    usedAt: Date,
    usedByEmail: String,
  },
  isSetupComplete: { type: Boolean, default: false },
  setupCompletedAt: Date,
  subscription: {
    plan: { type: String, enum: ['trial', 'starter', 'professional', 'enterprise', 'custom'], default: 'trial' },
    status: { type: String, enum: ['active', 'paused', 'expired', 'cancelled', 'pending'], default: 'pending' },
    startDate: Date,
    endDate: Date,
    billingCycle: { type: String, enum: ['monthly', 'quarterly', 'yearly', 'custom'], default: 'monthly' },
    amount: Number,
    currency: { type: String, default: 'INR' },
    maxUsers: { type: Number, default: 10 },
    currentUserCount: { type: Number, default: 0 },
    lastPaymentDate: Date,
    nextPaymentDate: Date,
    paymentHistory: [{
      amount: Number,
      date: Date,
      method: String,
      transactionId: String,
      notes: String,
    }],
  },
  serviceStatus: { type: String, enum: ['active', 'paused', 'suspended', 'terminated'], default: 'active' },
  servicePausedReason: String,
  servicePausedAt: Date,
  serviceResumedAt: Date,
  reminders: [{
    title: { type: String, required: true },
    description: String,
    dueDate: { type: Date, required: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'pending' },
    completedAt: Date,
    createdAt: { type: Date, default: Date.now },
    createdBy: mongoose.Schema.Types.ObjectId,
  }],
  notes: [{
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    createdBy: mongoose.Schema.Types.ObjectId,
    category: { type: String, enum: ['general', 'billing', 'support', 'technical', 'feedback'], default: 'general' },
  }],
  technicalDetails: {
    apiAccess: { type: Boolean, default: false },
    apiKey: String,
    webhookUrl: String,
    customDomain: String,
    sslEnabled: { type: Boolean, default: true },
    backupEnabled: { type: Boolean, default: true },
    lastBackupAt: Date,
  },
  analytics: {
    totalLogins: { type: Number, default: 0 },
    lastActivityAt: Date,
    storageUsedMB: { type: Number, default: 0 },
  },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin' },
  tags: [{ type: String, trim: true }],
}, { timestamps: true });

// UserTenantMapping Schema
const UserTenantMappingSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  tenantCompanyId: { type: mongoose.Schema.Types.ObjectId, ref: 'TenantCompany', required: true },
  databaseName: { type: String, required: true },
  companyName: { type: String, required: true },
  companySlug: { type: String, required: true },
  role: { type: String, default: 'employee' },
  isActive: { type: Boolean, default: true },
  lastLoginAt: Date,
  loginCount: { type: Number, default: 0 },
}, { timestamps: true });

// User Schema (minimal, just for reading existing users)
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String },
  isActive: { type: Boolean, default: true },
}, { strict: false });

async function registerFirstTenant() {
  console.log('🚀 Registering Mushroom World Group as first tenant...');

  try {
    // Connect to superadmin database
    const superadminUri = getDatabaseUri('talio_superadmin');
    console.log('📦 Connecting to talio_superadmin database...');
    
    const superadminConn = await mongoose.createConnection(superadminUri, {
      bufferCommands: true,
      maxPoolSize: 5,
      socketTimeoutMS: 30000,
      connectTimeoutMS: 10000,
      family: 4,
    }).asPromise();

    console.log('✅ Connected to talio_superadmin');

    // Connect to existing hrms_db (soon to be mushroom_world_group)
    const hrmsUri = getDatabaseUri('hrms_db');
    console.log('📦 Connecting to hrms_db...');
    
    const hrmsConn = await mongoose.createConnection(hrmsUri, {
      bufferCommands: true,
      maxPoolSize: 5,
      socketTimeoutMS: 30000,
      connectTimeoutMS: 10000,
      family: 4,
    }).asPromise();

    console.log('✅ Connected to hrms_db');

    // Create models
    const TenantCompany = superadminConn.model('TenantCompany', TenantCompanySchema);
    const UserTenantMapping = superadminConn.model('UserTenantMapping', UserTenantMappingSchema);
    const User = hrmsConn.model('User', UserSchema);

    // Check if tenant already exists
    const existingTenant = await TenantCompany.findOne({ slug: 'mushroom-world-group' });
    
    let tenant;
    if (existingTenant) {
      console.log('⚠️ Tenant mushroom-world-group already exists');
      tenant = existingTenant;
    } else {
      // Create tenant record
      tenant = new TenantCompany({
        name: 'Mushroom World Group',
        slug: 'mushroom-world-group',
        description: 'First Talio customer - Original deployment',
        databaseName: 'talio_company_mushroom_world_group', // New database name for migration
        primaryContact: {
          name: 'Mushroom World Group Admin',
          email: 'admin@mushroomworldgroup.com',
          phone: '',
        },
        isSetupComplete: true,
        setupCompletedAt: new Date(),
        subscription: {
          plan: 'enterprise',
          status: 'active',
          startDate: new Date(),
          endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
          billingCycle: 'yearly',
          maxUsers: 100,
        },
        serviceStatus: 'active',
        technicalDetails: {
          apiAccess: true,
          sslEnabled: true,
          backupEnabled: true,
        },
        tags: ['first-customer', 'enterprise'],
        notes: [{
          content: 'First Talio deployment. Originally used hrms_db database.',
          category: 'general',
          createdAt: new Date(),
        }],
      });

      await tenant.save();
      console.log('✅ Tenant record created for Mushroom World Group');
    }

    // Get all users from hrms_db
    console.log('📋 Fetching users from hrms_db...');
    const users = await User.find({ isActive: true }).lean();
    console.log(`   Found ${users.length} active users`);

    // Create user mappings
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const user of users) {
      if (!user.email) {
        skipped++;
        continue;
      }

      const existingMapping = await UserTenantMapping.findOne({ email: user.email.toLowerCase() });
      
      if (existingMapping) {
        // Update if needed
        if (existingMapping.tenantCompanyId.toString() !== tenant._id.toString()) {
          existingMapping.tenantCompanyId = tenant._id;
          existingMapping.databaseName = 'hrms_db'; // Keep using hrms_db for now until migration
          existingMapping.companyName = tenant.name;
          existingMapping.companySlug = tenant.slug;
          existingMapping.role = user.role || 'employee';
          await existingMapping.save();
          updated++;
        } else {
          skipped++;
        }
      } else {
        // Create new mapping
        await UserTenantMapping.create({
          email: user.email.toLowerCase(),
          tenantCompanyId: tenant._id,
          databaseName: 'hrms_db', // Keep using hrms_db for now
          companyName: tenant.name,
          companySlug: tenant.slug,
          role: user.role || 'employee',
          isActive: true,
        });
        created++;
      }
    }

    console.log(`\n📊 User Mapping Results:`);
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);

    // Update tenant user count
    tenant.subscription.currentUserCount = await UserTenantMapping.countDocuments({ 
      tenantCompanyId: tenant._id,
      isActive: true 
    });
    await tenant.save();

    console.log(`\n✅ Registration complete!`);
    console.log(`   Company: ${tenant.name}`);
    console.log(`   Slug: ${tenant.slug}`);
    console.log(`   Database: ${tenant.databaseName} (currently using hrms_db)`);
    console.log(`   Active Users: ${tenant.subscription.currentUserCount}`);

    await superadminConn.close();
    await hrmsConn.close();
    console.log('\n✅ Database connections closed');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error registering tenant:', error);
    process.exit(1);
  }
}

registerFirstTenant();
