/**
 * Tenant Setup Script
 * Creates a TenantCompany record and maps all users from a database to it
 * 
 * Usage: node scripts/setup-tenant.js <database_name> <company_name> <company_slug>
 * Example: node scripts/setup-tenant.js mushroom_world_group "Mushroom World Group" mushroom-world
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

// SuperAdmin database name
const SUPERADMIN_DB = 'talio_superadmin';

async function setupTenant(databaseName, companyName, companySlug) {
  if (!databaseName || !companyName || !companySlug) {
    console.error('Usage: node scripts/setup-tenant.js <database_name> <company_name> <company_slug>');
    console.error('Example: node scripts/setup-tenant.js mushroom_world_group "Mushroom World Group" mushroom-world');
    process.exit(1);
  }

  console.log(`\n🔧 Setting up tenant: ${companyName}`);
  console.log(`   Database: ${databaseName}`);
  console.log(`   Slug: ${companySlug}\n`);

  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI, { maxPoolSize: 10 });
    console.log('✅ Connected to MongoDB Atlas');

    // Get connections to databases
    const superadminDb = mongoose.connection.useDb(SUPERADMIN_DB);
    const tenantDb = mongoose.connection.useDb(databaseName);

    // Define schemas for superadmin collections
    const TenantCompanySchema = new mongoose.Schema({
      name: String,
      slug: { type: String, unique: true },
      databaseName: { type: String, unique: true },
      isActive: { type: Boolean, default: true },
      isSetupComplete: { type: Boolean, default: true },
      serviceStatus: { type: String, default: 'active' },
      subscription: {
        plan: { type: String, default: 'custom' },
        status: { type: String, default: 'active' },
        startDate: Date,
        endDate: Date,
        tenureDays: Number,
        amount: Number,
        maxUsers: { type: Number, default: 100 },
        maxStorageMB: { type: Number, default: 5000 },
      },
      primaryContact: {
        name: String,
        email: String,
        phone: String,
      },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    }, { collection: 'tenantcompanies' });

    const UserTenantMappingSchema = new mongoose.Schema({
      email: { type: String, unique: true, lowercase: true },
      tenantCompanyId: mongoose.Schema.Types.ObjectId,
      databaseName: String,
      companyName: String,
      companySlug: String,
      role: String,
      isActive: { type: Boolean, default: true },
      lastLoginAt: Date,
      loginCount: { type: Number, default: 0 },
      createdAt: { type: Date, default: Date.now },
    }, { collection: 'usertenantmappings' });

    const TenantCompany = superadminDb.model('TenantCompany', TenantCompanySchema);
    const UserTenantMapping = superadminDb.model('UserTenantMapping', UserTenantMappingSchema);

    // Check if tenant already exists
    let tenantCompany = await TenantCompany.findOne({ databaseName });
    
    if (tenantCompany) {
      console.log('ℹ️  Tenant company already exists, updating...');
      tenantCompany.name = companyName;
      tenantCompany.slug = companySlug;
      tenantCompany.updatedAt = new Date();
      await tenantCompany.save();
    } else {
      // Create TenantCompany
      tenantCompany = await TenantCompany.create({
        name: companyName,
        slug: companySlug,
        databaseName: databaseName,
        isActive: true,
        isSetupComplete: true,
        serviceStatus: 'active',
        subscription: {
          plan: 'custom',
          status: 'active',
          startDate: new Date(),
          endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
          tenureDays: 365,
          maxUsers: 100,
          maxStorageMB: 5000,
        },
      });
      console.log('✅ Created TenantCompany record');
    }

    // Get all users from tenant database
    const usersCollection = tenantDb.db.collection('users');
    const users = await usersCollection.find({}).toArray();
    console.log(`📦 Found ${users.length} users in ${databaseName}`);

    // Create user tenant mappings
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const user of users) {
      if (!user.email) {
        console.warn(`  ⚠️ Skipping user without email: ${user._id}`);
        continue;
      }

      try {
        const existing = await UserTenantMapping.findOne({ email: user.email.toLowerCase() });
        
        if (existing) {
          // Update existing mapping
          existing.tenantCompanyId = tenantCompany._id;
          existing.databaseName = databaseName;
          existing.companyName = companyName;
          existing.companySlug = companySlug;
          existing.role = user.role || 'employee';
          existing.isActive = user.isActive !== false;
          await existing.save();
          updated++;
        } else {
          // Create new mapping
          await UserTenantMapping.create({
            email: user.email.toLowerCase(),
            tenantCompanyId: tenantCompany._id,
            databaseName: databaseName,
            companyName: companyName,
            companySlug: companySlug,
            role: user.role || 'employee',
            isActive: user.isActive !== false,
          });
          created++;
        }
      } catch (err) {
        if (err.code === 11000) {
          // Duplicate key - already exists
          updated++;
        } else {
          console.error(`  ❌ Error mapping ${user.email}:`, err.message);
          errors++;
        }
      }
    }

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`✅ Tenant setup complete!`);
    console.log(`   Company: ${companyName}`);
    console.log(`   Database: ${databaseName}`);
    console.log(`   Slug: ${companySlug}`);
    console.log(`   Users Created: ${created}`);
    console.log(`   Users Updated: ${updated}`);
    console.log(`   Errors: ${errors}`);
    console.log(`${'─'.repeat(50)}`);

    // Print login info
    console.log(`\n📋 Login Info:`);
    console.log(`   Users can now log in with their existing credentials.`);
    console.log(`   The system will automatically route them to: ${databaseName}`);

  } catch (error) {
    console.error('❌ Error setting up tenant:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Get command line arguments
const [,, dbName, companyName, slug] = process.argv;

setupTenant(dbName, companyName, slug);
