/**
 * Seed Initial SuperAdmin User
 * 
 * Run this script to create the first superadmin user:
 * SUPERADMIN_PASSWORD='your-password' node scripts/seed-superadmin.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
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

// SuperAdmin Schema (duplicated here for standalone script)
const SuperAdminSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
    select: false,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  lastLogin: {
    type: Date,
  },
  permissions: {
    canCreateCompanies: { type: Boolean, default: true },
    canDeleteCompanies: { type: Boolean, default: true },
    canManageSubscriptions: { type: Boolean, default: true },
    canManageSuperadmins: { type: Boolean, default: false },
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SuperAdmin',
  },
}, {
  timestamps: true,
});

async function seedSuperAdmin() {
  console.log('🚀 Starting SuperAdmin seed...');
  
  // SuperAdmin credentials
  const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || 'avi2001raj@gmail.com';
  const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;
  const SUPERADMIN_NAME = process.env.SUPERADMIN_NAME || 'Aviraj Sharma';

  if (!SUPERADMIN_PASSWORD) {
    throw new Error('SUPERADMIN_PASSWORD environment variable is required');
  }

  try {
    // Connect to superadmin database
    const uri = getDatabaseUri('talio_superadmin');
    console.log('📦 Connecting to talio_superadmin database...');
    
    const connection = await mongoose.createConnection(uri, {
      bufferCommands: true,
      maxPoolSize: 5,
      socketTimeoutMS: 30000,
      connectTimeoutMS: 10000,
      family: 4,
    }).asPromise();

    console.log('✅ Connected to talio_superadmin database');

    // Create SuperAdmin model
    const SuperAdmin = connection.model('SuperAdmin', SuperAdminSchema);

    // Check if superadmin already exists
    const existingSuperAdmin = await SuperAdmin.findOne({ email: SUPERADMIN_EMAIL });
    
    if (existingSuperAdmin) {
      console.log('⚠️ SuperAdmin already exists with email:', SUPERADMIN_EMAIL);
      console.log('   Updating password...');
      
      // Update password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(SUPERADMIN_PASSWORD, salt);
      
      await SuperAdmin.updateOne(
        { email: SUPERADMIN_EMAIL },
        { 
          $set: { 
            password: hashedPassword,
            isActive: true,
            permissions: {
              canCreateCompanies: true,
              canDeleteCompanies: true,
              canManageSubscriptions: true,
              canManageSuperadmins: true, // Root superadmin can manage others
            },
          } 
        }
      );
      
      console.log('✅ SuperAdmin password updated successfully');
    } else {
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(SUPERADMIN_PASSWORD, salt);

      // Create superadmin
      const superadmin = new SuperAdmin({
        email: SUPERADMIN_EMAIL,
        password: hashedPassword,
        name: SUPERADMIN_NAME,
        isActive: true,
        permissions: {
          canCreateCompanies: true,
          canDeleteCompanies: true,
          canManageSubscriptions: true,
          canManageSuperadmins: true, // Root superadmin can manage others
        },
      });

      await superadmin.save();
      console.log('✅ SuperAdmin created successfully!');
    }

    console.log('\n📋 SuperAdmin Details:');
    console.log('   Email:', SUPERADMIN_EMAIL);
    console.log('   Password:', SUPERADMIN_PASSWORD);
    console.log('   Database: talio_superadmin');
    console.log('\n🔐 Login at: /superadmin/login');

    await connection.close();
    console.log('\n✅ Database connection closed');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error seeding superadmin:', error);
    process.exit(1);
  }
}

seedSuperAdmin();
