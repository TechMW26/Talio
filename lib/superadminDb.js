/**
 * SuperAdmin Database Connection
 * 
 * This file handles connections to the superadmin database which is separate
 * from company-specific databases. The superadmin database stores:
 * - SuperAdmin users (platform administrators)
 * - TenantCompany records (companies using Talio)
 * - Setup codes for new company onboarding
 */

import mongoose from 'mongoose';

// Get the cluster URI without a specific database
const MONGODB_URI = process.env.MONGODB_URI;

// Extract cluster base URI (without database name)
function getClusterBaseUri() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not defined');
  }
  
  // Parse the URI to extract base cluster URL
  // mongodb+srv://user:pass@cluster.mongodb.net/database?options
  const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/);
  
  if (!match) {
    throw new Error('Invalid MONGODB_URI format');
  }
  
  return {
    baseUri: match[1],
    options: match[3] || ''
  };
}

/**
 * Get connection URI for a specific database
 */
export function getDatabaseUri(databaseName) {
  const { baseUri, options } = getClusterBaseUri();
  return `${baseUri}/${databaseName}${options}`;
}

// Cached superadmin connection
let superadminConnection = null;

/**
 * Connect to the superadmin database
 * This is a separate connection from the main app database
 */
export async function connectSuperadminDB() {
  if (superadminConnection && superadminConnection.readyState === 1) {
    return superadminConnection;
  }

  const uri = getDatabaseUri('talio_superadmin');
  
  try {
    superadminConnection = await mongoose.createConnection(uri, {
      bufferCommands: true,
      maxPoolSize: 5,
      minPoolSize: 1,
      socketTimeoutMS: 30000,
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
      family: 4,
      retryWrites: true,
      retryReads: true,
    }).asPromise();

    console.log('✅ SuperAdmin DB connected successfully');
    
    // Handle connection events
    superadminConnection.on('error', (err) => {
      console.error('❌ SuperAdmin DB connection error:', err.message);
    });

    superadminConnection.on('disconnected', () => {
      console.warn('⚠️ SuperAdmin DB disconnected');
      superadminConnection = null;
    });

    return superadminConnection;
  } catch (error) {
    console.error('❌ SuperAdmin DB Connection Error:', error.message);
    superadminConnection = null;
    throw error;
  }
}

/**
 * Get the superadmin database connection
 */
export function getSuperadminConnection() {
  return superadminConnection;
}

export default connectSuperadminDB;
