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
import dns from 'dns';

// Configure DNS to use Google's DNS servers for reliable SRV resolution
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

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
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;

// Production-aware connection options
const isProduction = process.env.NODE_ENV === 'production';

const SUPERADMIN_CONNECTION_OPTIONS = {
  bufferCommands: true,
  maxPoolSize: isProduction ? 20 : 5,
  minPoolSize: isProduction ? 5 : 1,
  socketTimeoutMS: isProduction ? 60000 : 30000,
  connectTimeoutMS: isProduction ? 20000 : 10000,
  serverSelectionTimeoutMS: isProduction ? 20000 : 10000,
  family: 4, // Force IPv4 to avoid querySrv ETIMEOUT errors
  retryWrites: true,
  retryReads: true,
  maxIdleTimeMS: isProduction ? 120000 : 60000,
  compressors: ['zlib'],
  autoIndex: !isProduction,
};

/**
 * Connect to the superadmin database
 * This is a separate connection from the main app database
 */
export async function connectSuperadminDB() {
  // Return existing healthy connection
  if (superadminConnection && superadminConnection.readyState === 1) {
    return superadminConnection;
  }
  
  // Clear stale connection
  if (superadminConnection && superadminConnection.readyState !== 1) {
    try {
      await superadminConnection.close();
    } catch (e) {
      // Ignore close errors
    }
    superadminConnection = null;
  }

  const uri = getDatabaseUri('talio_superadmin');
  
  // Retry loop for transient connection errors
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_CONNECTION_ATTEMPTS; attempt++) {
    try {
      superadminConnection = await mongoose.createConnection(uri, SUPERADMIN_CONNECTION_OPTIONS).asPromise();

      console.log('✅ SuperAdmin DB connected successfully');
      connectionAttempts = 0; // Reset on success
      
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
      lastError = error;
      console.error(`❌ SuperAdmin DB Connection Error (attempt ${attempt}/${MAX_CONNECTION_ATTEMPTS}):`, error.message);
      superadminConnection = null;
      
      // Check if it's a transient error worth retrying
      const isTransient = error.message.includes('ETIMEOUT') || 
                         error.message.includes('ECONNREFUSED') ||
                         error.message.includes('querySrv') ||
                         error.message.includes('getaddrinfo');
      
      if (isTransient && attempt < MAX_CONNECTION_ATTEMPTS) {
        // Wait before retry (exponential backoff)
        const waitTime = 1000 * attempt;
        console.log(`🔄 Retrying SuperAdmin DB connection in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // Non-transient error or max retries reached
      throw error;
    }
  }
  
  // If we get here, all retries failed
  throw lastError || new Error('Failed to connect to SuperAdmin DB after retries');
}

/**
 * Get the superadmin database connection
 */
export function getSuperadminConnection() {
  return superadminConnection;
}

export default connectSuperadminDB;
